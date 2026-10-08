import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import {
  isSameSpendRequest,
  parseSpendPayload,
  requestToApi,
  vaultAddressFor,
  type RequestState,
} from "../src/lib/apiServer";

const agent: Address = "0x1111111111111111111111111111111111111111";
const recipient: Address = "0x2222222222222222222222222222222222222222";
const vault: Address = "0x3333333333333333333333333333333333333333";
const funding: Address = "0x4444444444444444444444444444444444444444";

const BASE_SEPOLIA = 84532;
const ARC_TESTNET = 5042002;

function body(overrides: Record<string, unknown> = {}) {
  return {
    agent,
    recipient,
    amount: "10",
    category: "infrastructure",
    justification: "monthly observability invoice",
    idempotency_key: "key-0000001",
    ...overrides,
  };
}

// --- destination parsing -----------------------------------------------------------------------

test("a request with no destination leaves the policy settlement chain to decide", () => {
  assert.equal(parseSpendPayload(body()).destinationChainId, undefined);
  assert.equal(parseSpendPayload(body({ destination_chain: "" })).destinationChainId, undefined);
  assert.equal(parseSpendPayload(body({ destination_chain: null })).destinationChainId, undefined);
});

test("a destination chain is accepted as a number or a string, under any accepted key", () => {
  assert.equal(parseSpendPayload(body({ destination_chain: ARC_TESTNET })).destinationChainId, ARC_TESTNET);
  assert.equal(parseSpendPayload(body({ destination_chain: String(ARC_TESTNET) })).destinationChainId, ARC_TESTNET);
  assert.equal(parseSpendPayload(body({ destination_chain_id: BASE_SEPOLIA })).destinationChainId, BASE_SEPOLIA);
  assert.equal(parseSpendPayload(body({ destinationChainId: BASE_SEPOLIA })).destinationChainId, BASE_SEPOLIA);
  assert.equal(parseSpendPayload(body({ destination_chain: " 5042002 " })).destinationChainId, ARC_TESTNET);
});

test("an unsupported or malformed destination chain is refused at the API boundary", () => {
  // Rejected here so the agent gets a clear error rather than an on-chain policy denial.
  assert.throws(() => parseSpendPayload(body({ destination_chain: 999999 })), /not a supported chain/);
  assert.throws(() => parseSpendPayload(body({ destination_chain: 0 })), /positive integer/);
  assert.throws(() => parseSpendPayload(body({ destination_chain: -1 })), /positive integer/);
  assert.throws(() => parseSpendPayload(body({ destination_chain: 1.5 })), /positive integer/);
  assert.throws(() => parseSpendPayload(body({ destination_chain: "abc" })), /positive integer/);
});

// --- idempotency identity ----------------------------------------------------------------------

function stored(overrides: Partial<RequestState> = {}): RequestState {
  return {
    request_id: "0xabc",
    recipient,
    amount_atto: "10000000",
    category: "infrastructure",
    justification: "monthly observability invoice",
    verdict: "approved",
    reasoning: "",
    tx_hash: "",
    created_at: "2026-10-06T00:00:00Z",
    evidence_digest: "0xdigest",
    destination_chain_id: String(BASE_SEPOLIA),
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    recipient,
    amountUnits: 10_000_000n,
    category: "infrastructure",
    justification: "monthly observability invoice",
    destinationChainId: BASE_SEPOLIA,
    evidenceDigest: "0xDIGEST",
    settlementChainId: BASE_SEPOLIA,
    ...overrides,
  } as Parameters<typeof isSameSpendRequest>[1];
}

test("an identical replay is recognised, case-insensitively on the evidence digest", () => {
  assert.equal(isSameSpendRequest(stored(), candidate()), true);
});

test("one idempotency key cannot be replayed to a different destination chain", () => {
  // The security property: without this, a caller could reuse an approved key and have the funds
  // settle somewhere the policy never reviewed.
  assert.equal(isSameSpendRequest(stored(), candidate({ destinationChainId: ARC_TESTNET })), false);
  assert.equal(
    isSameSpendRequest(stored({ destination_chain_id: String(ARC_TESTNET) }), candidate()),
    false,
  );
});

test("a pre-V6 record with no stored destination reads as its own settlement chain", () => {
  const legacy = stored({ destination_chain_id: undefined });
  assert.equal(isSameSpendRequest(legacy, candidate()), true);
  assert.equal(isSameSpendRequest(legacy, candidate({ destinationChainId: ARC_TESTNET })), false);
});

test("any other changed field still breaks the replay match", () => {
  assert.equal(isSameSpendRequest(stored(), candidate({ amountUnits: 10_000_001n })), false);
  assert.equal(isSameSpendRequest(stored(), candidate({ category: "marketing" })), false);
  assert.equal(isSameSpendRequest(stored(), candidate({ justification: "something else" })), false);
  assert.equal(isSameSpendRequest(stored(), candidate({ evidenceDigest: "0xother" })), false);
  assert.equal(
    isSameSpendRequest(stored(), candidate({ recipient: "0x9999999999999999999999999999999999999999" })),
    false,
  );
});

// --- vault resolution --------------------------------------------------------------------------

test("an explicit V6 vault address wins over the funding account", () => {
  assert.equal(vaultAddressFor({ vault_address: vault, delegated_account: funding }), vault);
});

test("a policy without an explicit vault falls back to the registry-pinned funding account", () => {
  assert.equal(vaultAddressFor({ delegated_account: funding }), funding);
});

test("a policy with neither has no vault", () => {
  assert.equal(vaultAddressFor({}), undefined);
  assert.equal(vaultAddressFor({ vault_address: "not-an-address" }), undefined);
});

// --- API response ------------------------------------------------------------------------------

test("the API surfaces the route, destination chain and bridge lifecycle", () => {
  const api = requestToApi(
    stored({
      destination_chain_id: String(BASE_SEPOLIA),
      route: "cctp",
      bridge_tx_hash: "0xburn",
      attestation_status: "attested",
      destination_tx_hash: "0xmint",
      execution_status: "bridging",
    }),
    6,
    ARC_TESTNET,
  );
  assert.equal(api.route, "cctp");
  assert.equal(api.destination_chain?.chain_id, BASE_SEPOLIA);
  assert.equal(api.chain?.chain_id, ARC_TESTNET);
  assert.equal(api.bridge.tx_hash, "0xburn");
  assert.equal(api.bridge.attestation_status, "attested");
  assert.equal(api.bridge.destination_tx_hash, "0xmint");
  assert.ok(api.bridge.destination_explorer_url?.includes("sepolia.basescan.org"));
});

test("a direct request reports its own chain as the destination and an empty bridge", () => {
  const api = requestToApi(stored({ destination_chain_id: undefined, route: undefined }), 6, ARC_TESTNET);
  assert.equal(api.route, "direct");
  assert.equal(api.destination_chain?.chain_id, ARC_TESTNET);
  assert.equal(api.bridge.tx_hash, "");
  assert.equal(api.bridge.destination_explorer_url, null);
});
