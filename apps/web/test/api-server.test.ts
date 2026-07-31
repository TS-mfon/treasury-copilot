import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentApiKeyClaims } from "../src/lib/apiAuth";
import {
  assertPolicyMatchesApiKey,
  chainToApi,
  parseSpendPayload,
  policySecurityProfile,
  publicPolicyState,
  requestToApi,
} from "../src/lib/apiServer";

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
    contract_version: "4",
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    evm_chain_id: String(claims.chainId),
    execution_reporter: platform.address,
    delegation_registered: true,
    delegation_payload: { context: "0x01" },
    auto_approve_threshold_atto: "0",
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
  assert.equal("auto_approve_threshold_atto" in state, false);
});

test("legacy fast approval is surfaced as an explicit security warning", () => {
  const profile = policySecurityProfile({
    contract_version: "2",
    auto_approve_threshold_atto: "5000000",
    delegation_registered: true,
  });
  assert.equal(profile.legacy_fast_approval_active, true);
  assert.equal(profile.semantic_review_required_for_all_requests, false);
  assert.match(profile.warnings[0] ?? "", /without semantic policy review/);
});

test("policy V3 requires semantic review for every request", () => {
  const profile = policySecurityProfile({
    contract_version: "3",
    auto_approve_threshold_atto: "0",
    delegation_registered: true,
  });
  assert.equal(profile.legacy_fast_approval_active, false);
  assert.equal(profile.semantic_review_required_for_all_requests, true);
  assert.equal(profile.asynchronous_review_supported, false);
  assert.equal(profile.immediate_review_submission, false);
  assert.match(profile.warnings[0] ?? "", /migrated to V4/);
});

test("policy V5 starts comparative review in the submission transaction", () => {
  const profile = policySecurityProfile({
    contract_version: "5",
    auto_approve_threshold_atto: "0",
    delegation_registered: true,
  });
  assert.equal(profile.semantic_review_required_for_all_requests, true);
  assert.equal(profile.asynchronous_review_supported, true);
  assert.equal(profile.immediate_review_submission, true);
  assert.deepEqual(profile.warnings, []);
});

test("legacy policies are blocked from asynchronous agent spending", () => {
  assert.throws(() => assertPolicyMatchesApiKey({
    contract_version: "3",
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    evm_chain_id: String(claims.chainId),
    execution_reporter: platform.address,
    delegation_registered: true,
    delegation_payload: { context: "0x01" },
    auto_approve_threshold_atto: "0",
  }, claims), /Policy migration required/);
});

test("request responses include chain metadata and decision mode", () => {
  const response = requestToApi({
    request_id: `0x${"a".repeat(64)}`,
    recipient: address("6"),
    amount_atto: "5000001",
    category: "vercel_subscription",
    justification: "Pay a verified Vercel invoice",
    verdict: "approved",
    reasoning: "Matches the exact recipient in policy",
    tx_hash: "",
    created_at: "2026-07-26T12:00:00Z",
    finalized: true,
  }, 6, 84532);

  assert.equal(response.decision_mode, "prompt_comparative");
  assert.equal(response.chain?.name, "Base Sepolia");
  assert.equal(chainToApi(8453).name, "Base Mainnet");
});
