import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { issueAgentApiKey, verifyAgentApiKey } from "../src/lib/apiAuth";
import { ownerNonce, ownerSession, sessionOwner, verifyOwnerNonce } from "../src/lib/ownerAuth";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const agent = privateKeyToAccount(`0x${"22".repeat(32)}`);
const policy = privateKeyToAccount(`0x${"33".repeat(32)}`);
const token = privateKeyToAccount(`0x${"44".repeat(32)}`);

process.env.AGENT_API_KEY_SECRET = "test-agent-key-secret-at-least-32-bytes";
process.env.OWNER_SESSION_SECRET = "test-owner-session-secret-at-least-32";

test("agent API key round-trips immutable binding claims", () => {
  const key = issueAgentApiKey({
    keyId: "test-key-id",
    keyVersion: 3,
    owner: account.address,
    agent: agent.address,
    policy: policy.address,
    delegatedAccount: account.address,
    chainId: 84532,
    token: token.address,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    issuedAt: 1_800_000_000,
  });
  const claims = verifyAgentApiKey(key);
  assert.equal(claims.keyVersion, 3);
  assert.equal(claims.agent, agent.address);
  assert.equal(claims.policy, policy.address);
  assert.equal(claims.tokenDecimals, 6);
});

test("agent API key tampering fails closed", () => {
  const key = issueAgentApiKey({
    keyId: "test-key-id",
    keyVersion: 1,
    owner: account.address,
    agent: agent.address,
    policy: policy.address,
    delegatedAccount: account.address,
    chainId: 84532,
    token: token.address,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
  });
  assert.throws(() => verifyAgentApiKey(`${key.slice(0, -1)}x`), /Invalid agent API key signature/);
});

test("each API key issuance has a unique key id for the bound agent policy", () => {
  const claims = {
    keyVersion: 1,
    owner: account.address,
    agent: agent.address,
    policy: policy.address,
    delegatedAccount: account.address,
    chainId: 84532,
    token: token.address,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    issuedAt: 1_800_000_000,
  };
  const first = issueAgentApiKey({ ...claims, keyId: crypto.randomUUID() });
  const second = issueAgentApiKey({ ...claims, keyId: crypto.randomUUID() });

  assert.notEqual(first, second);
  assert.notEqual(verifyAgentApiKey(first).keyId, verifyAgentApiKey(second).keyId);
});

test("owner nonce and session tokens are bound and tamper resistant", () => {
  const challenge = ownerNonce(account.address);
  assert.doesNotThrow(() => verifyOwnerNonce(challenge.token, account.address, challenge.nonce));
  assert.throws(() => verifyOwnerNonce(challenge.token, agent.address, challenge.nonce), /does not match/);
  const session = ownerSession(account.address);
  assert.equal(sessionOwner(session), account.address);
  assert.throws(() => sessionOwner(`${session.slice(0, -1)}x`), /Invalid owner session/);
});
