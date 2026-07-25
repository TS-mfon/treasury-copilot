import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentApiKeyClaims } from "../src/lib/apiAuth";
import { assertPolicyMatchesApiKey, parseSpendPayload, publicPolicyState } from "../src/lib/apiServer";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const platformKey = `0x${"99".repeat(32)}` as const;
const platform = privateKeyToAccount(platformKey);
process.env.AGENT_SIGNER_PRIVATE_KEY = platformKey;

const claims: AgentApiKeyClaims = {
  type: "agent",
  version: 1,
  keyId: "key-12345678",
  keyVersion: 1,
  owner: address("1"),
  agent: address("2"),
  policy: address("3"),
  delegatedAccount: address("4"),
  chainId: 84532,
  token: address("5"),
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  issuedAt: 1_800_000_000,
};

test("spend payload requires a registered agent address and decimal string", () => {
  const parsed = parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "25.00",
    category: "software",
    justification: "Production API invoice",
    idempotency_key: "invoice-2026-0001",
  });
  assert.equal(parsed.agent, claims.agent);
  assert.equal(parsed.amount, "25.00");
});

test("spend payload bounds idempotency and prompt inputs", () => {
  assert.throws(() => parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "1",
    category: "x",
    justification: "valid",
  }), /Category/);
  assert.throws(() => parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "1",
    category: "software",
    justification: "valid",
    idempotency_key: "short",
  }), /idempotency_key/);
});

test("policy binding rejects cross-agent and cross-funding claims", () => {
  const matching = {
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    evm_chain_id: String(claims.chainId),
    execution_reporter: platform.address,
    delegation_registered: true,
    delegation_payload: { context: "0x01" },
  };
  assert.doesNotThrow(() => assertPolicyMatchesApiKey(matching, claims));
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, authorized_agent: address("7") }, claims), /agent/);
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, delegated_account: address("8") }, claims), /delegated account/);
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, execution_reporter: address("8") }, claims), /Platform signer/);
});

test("agent policy responses redact executable delegation secrets", () => {
  const state = publicPolicyState({
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    delegation_registered: true,
    delegation_context: "0xsecret",
    delegation_payload: { signature: "secret" },
    evm_chain_id: String(claims.chainId),
    per_tx_cap_atto: "25000000",
  });
  assert.equal(state.delegation_registered, true);
  assert.equal(state.per_tx_cap_atto, "25000000");
  assert.equal("delegation_payload" in state, false);
  assert.equal("delegation_context" in state, false);
});
