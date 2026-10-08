import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { advanceBridgedRequest, isBridging } from "../src/lib/cctpBridge";
import type { RequestState } from "../src/lib/apiServer";
import type { AttestationStatus } from "../src/lib/cctp";

const ARC_TESTNET = 5042002;
const BASE_SEPOLIA = 84532;
const policy: Address = "0x704345601942b0e7ec503bffd6faca5f40d746e9";
const BURN: Hex = `0x${"11".repeat(32)}`;
const MINT: Hex = `0x${"22".repeat(32)}`;

function bridging(overrides: Partial<RequestState> = {}): RequestState {
  return {
    request_id: `0x${"ab".repeat(32)}`,
    recipient: "0xed9edd8586b20524cafa4f568413c504c9b03172",
    amount_atto: "1000000",
    category: "infrastructure",
    justification: "monthly invoice",
    verdict: "approved",
    reasoning: "",
    tx_hash: "",
    created_at: "2026-10-08T00:00:00Z",
    execution_status: "bridging",
    destination_chain_id: String(BASE_SEPOLIA),
    route: "cctp",
    bridge_tx_hash: BURN,
    ...overrides,
  };
}

function recorder() {
  const writes: Array<{ method: string; args: unknown[] }> = [];
  const writeImpl = (async (_policy: Address, method: string, args: unknown[]) => {
    writes.push({ method, args });
    return { hash: "0xwrite" } as never;
  }) as never;
  return { writes, writeImpl };
}

function attestationOf(value: AttestationStatus | undefined) {
  return (async () => value) as never;
}

test("only a bridging request is picked up by this stage", () => {
  assert.equal(isBridging({ execution_status: "bridging" }), true);
  assert.equal(isBridging({ execution_status: "executing" }), false);
  assert.equal(isBridging({ execution_status: "executed" }), false);
  assert.equal(isBridging({ execution_status: undefined }), false);
});

test("an unminted transfer stays pending and writes nothing", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(policy, bridging(), ARC_TESTNET, {
    writeImpl,
    fetchAttestationImpl: attestationOf({ status: "pending", attestation: "0xabc", complete: false }),
  });
  assert.equal(outcome.status, "pending");
  // Marking it executed here would report a payment the payee cannot yet spend.
  assert.equal(writes.length, 0);
});

test("a burn Circle has not indexed yet stays pending", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(policy, bridging(), ARC_TESTNET, {
    writeImpl,
    fetchAttestationImpl: attestationOf(undefined),
  });
  assert.equal(outcome.status, "pending");
  assert.equal(writes.length, 0);
});

test("a completed mint records the attestation and then closes the request", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(policy, bridging(), ARC_TESTNET, {
    writeImpl,
    fetchAttestationImpl: attestationOf({
      status: "complete", attestation: "0xabc", forwardTxHash: MINT, complete: true,
    }),
  });

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.status === "completed" && outcome.destinationTxHash, MINT);
  assert.deepEqual(writes.map((write) => write.method), ["record_bridge_attested", "record_execution"]);
  // Both writes must carry the destination transaction, which is the payee's actual receipt.
  for (const write of writes) assert.equal(write.args[1], MINT);
});

test("a request that already has a destination transaction is a no-op on re-run", async () => {
  const { writes, writeImpl } = recorder();
  let fetched = 0;
  const outcome = await advanceBridgedRequest(
    policy,
    bridging({ destination_tx_hash: MINT }),
    ARC_TESTNET,
    {
      writeImpl,
      fetchAttestationImpl: (async () => {
        fetched += 1;
        return { status: "complete", forwardTxHash: MINT, complete: true };
      }) as never,
    },
  );
  // Idempotency: a duplicate cron worker must not re-record an execution.
  assert.equal(outcome.status, "completed");
  assert.equal(writes.length, 0);
  assert.equal(fetched, 0, "a settled request should not be re-queried");
});

test("a bridging request with no burn transaction is reported as failed, not retried forever", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(
    policy,
    bridging({ bridge_tx_hash: "" }),
    ARC_TESTNET,
    { writeImpl, fetchAttestationImpl: attestationOf(undefined) },
  );
  assert.equal(outcome.status, "failed");
  assert.match(outcome.status === "failed" ? outcome.error : "", /no burn transaction/);
  assert.equal(writes.length, 0);
});

test("an unresolvable route fails with the stage named rather than throwing", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(
    policy,
    // X Layer Testnet has no CCTP deployment, so no route exists.
    bridging({ destination_chain_id: "1952" }),
    ARC_TESTNET,
    { writeImpl, fetchAttestationImpl: attestationOf(undefined) },
  );
  assert.equal(outcome.status, "failed");
  assert.match(outcome.status === "failed" ? outcome.error : "", /cannot resolve CCTP route/);
  assert.equal(writes.length, 0);
});

test("a cross-environment destination fails rather than producing a bogus route", async () => {
  const { writes, writeImpl } = recorder();
  const outcome = await advanceBridgedRequest(
    policy,
    bridging({ destination_chain_id: "8453" }),
    ARC_TESTNET,
    { writeImpl, fetchAttestationImpl: attestationOf(undefined) },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(writes.length, 0);
});
