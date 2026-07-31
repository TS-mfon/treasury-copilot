import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { bearerToken, issueAgentApiKey, verifyAgentApiKey } from "../src/lib/apiAuth";
import { ownerNonce, ownerSession, sessionOwner, verifyOwnerNonce } from "../src/lib/ownerAuth";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const agent = privateKeyToAccount(`0x${"22".repeat(32)}`);
const policy = privateKeyToAccount(`0x${"33".repeat(32)}`);
const token = privateKeyToAccount(`0x${"44".repeat(32)}`);

process.env.AGENT_API_KEY_SECRET = "test-agent-key-secret-at-least-32-bytes";
process.env.OWNER_SESSION_SECRET = "test-owner-session-secret-at-least-32";
const testIssuedAt = Math.floor(Date.now() / 1000);
const apiKeySecret = process.env.AGENT_API_KEY_SECRET!;

function legacyApiKey(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", apiKeySecret).update(payload).digest("base64url");
  return `tcp_${payload}.${signature}`;
}

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
    issuedAt: testIssuedAt,
  });
  const claims = verifyAgentApiKey(key);
  assert.equal(claims.keyVersion, 3);
  assert.equal(claims.agent, agent.address);
  assert.equal(claims.policy, policy.address);
  assert.equal(claims.tokenDecimals, 6);
  assert.ok(claims.expiresAt);
  assert.ok(claims.expiresAt > claims.issuedAt);
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

test("malformed API keys and bearer headers fail closed", () => {
  assert.throws(() => verifyAgentApiKey("tcp_not-json.signature"), /Invalid agent API key/);
  assert.throws(
    () => bearerToken(new Request("https://example.test", {
      headers: { authorization: "Bearer one extra" },
    })),
    /bearer token required/,
  );
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
    issuedAt: testIssuedAt,
  };
  const first = issueAgentApiKey({ ...claims, keyId: crypto.randomUUID() });
  const second = issueAgentApiKey({ ...claims, keyId: crypto.randomUUID() });

  assert.notEqual(first, second);
  assert.notEqual(verifyAgentApiKey(first).keyId, verifyAgentApiKey(second).keyId);
});

test("agent API keys reject expired and future-issued credentials", () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    keyId: "expiring-key-id",
    keyVersion: 1,
    owner: account.address,
    agent: agent.address,
    policy: policy.address,
    delegatedAccount: account.address,
    chainId: 84532,
    token: token.address,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
  };
  const expired = issueAgentApiKey({
    ...base,
    issuedAt: now - 100,
    expiresAt: now - 1,
  });
  assert.throws(() => verifyAgentApiKey(expired), /API key expired/);

  const future = issueAgentApiKey({
    ...base,
    issuedAt: now + 10 * 60,
    expiresAt: now + 20 * 60,
  });
  assert.throws(() => verifyAgentApiKey(future), /Invalid issued timestamp/);
});

test("legacy keys without expiresAt receive the same 30-day maximum lifetime", () => {
  const claims = {
    type: "agent",
    version: 1,
    keyId: "legacy-key-id",
    keyVersion: 1,
    owner: account.address,
    agent: agent.address,
    policy: policy.address,
    delegatedAccount: account.address,
    chainId: 84532,
    token: token.address,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    issuedAt: testIssuedAt,
  };
  const verified = verifyAgentApiKey(legacyApiKey(claims));
  assert.equal(verified.expiresAt, testIssuedAt + 30 * 24 * 60 * 60);

  assert.throws(() => verifyAgentApiKey(legacyApiKey({
    ...claims,
    issuedAt: testIssuedAt - 31 * 24 * 60 * 60,
  })), /API key expired/);
});

test("owner nonce and session tokens are bound and tamper resistant", () => {
  const challenge = ownerNonce(account.address);
  assert.doesNotThrow(() => verifyOwnerNonce(challenge.token, account.address, challenge.nonce));
  assert.throws(() => verifyOwnerNonce(challenge.token, agent.address, challenge.nonce), /does not match/);
  const session = ownerSession(account.address);
  assert.equal(sessionOwner(session), account.address);
  assert.throws(() => sessionOwner(`${session.slice(0, -1)}x`), /Invalid owner session/);
});
