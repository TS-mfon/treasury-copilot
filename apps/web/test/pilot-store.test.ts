import assert from "node:assert/strict";
import test from "node:test";
import { correlationId, pilotRequestFromState, pilotStoreConfigured, pilotStoreHealth, withCorrelation } from "../src/lib/pilotStore";
import type { AgentApiKeyClaims } from "../src/lib/apiAuth";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const claims: AgentApiKeyClaims = {
  type: "agent",
  version: 1,
  keyId: "pilot-key-1234",
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

test("correlation IDs accept safe client values and replace unsafe values", () => {
  assert.equal(correlationId(new Request("https://example.test", { headers: { "x-correlation-id": "pilot_2026_001" } })), "pilot_2026_001");
  assert.match(correlationId(new Request("https://example.test", { headers: { "x-correlation-id": "bad value" } })), /^corr_/);
});

test("correlation IDs are returned as response headers", () => {
  const response = withCorrelation(Response.json({ ok: true }), "corr_test_1234");
  assert.equal(response.headers.get("x-correlation-id"), "corr_test_1234");
});

test("pilot projections contain safe metadata and normalized addresses", () => {
  const projection = pilotRequestFromState({
    claims,
    correlationId: "corr_test_1234",
    request: {
      request_id: `0x${"a".repeat(64)}`,
      recipient: address("6"),
      amount_atto: "1000000",
      category: "api_subscription",
      justification: "Private text is not persisted in the pilot projection",
      verdict: "pending",
      reasoning: "Submitted",
      tx_hash: "",
      created_at: "2026-09-21T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:00.000Z",
      execution_status: "submitted",
      execution_error: "",
      finalized: false,
    },
  });
  assert.equal(projection.owner, claims.owner.toLowerCase());
  assert.equal(projection.recipient, address("6").toLowerCase());
  assert.equal("justification" in projection, false);
  assert.equal("evidence" in projection, false);
});

test("pilot store is optional during local development", () => {
  const previous = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  assert.equal(pilotStoreConfigured(), false);
  if (previous) process.env.MONGODB_URI = previous;
});

test("an unreachable pilot store reports unavailable without memoizing the failure", async () => {
  const previous = process.env.MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=250&connectTimeoutMS=250";
  globalThis.__treasuryCopilotMongoClientPromise = undefined;
  try {
    assert.equal(await pilotStoreHealth(), "unavailable");
    // A rejected connect must not stay cached, or a single unreachable moment
    // keeps reporting unavailable until the serverless instance is recycled.
    assert.equal(globalThis.__treasuryCopilotMongoClientPromise, undefined);
    assert.equal(await pilotStoreHealth(), "unavailable");
    assert.equal(globalThis.__treasuryCopilotMongoClientPromise, undefined);
  } finally {
    globalThis.__treasuryCopilotMongoClientPromise = undefined;
    if (previous) process.env.MONGODB_URI = previous;
    else delete process.env.MONGODB_URI;
  }
});
