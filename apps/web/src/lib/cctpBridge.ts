import type { Address, Hex } from "viem";
import { chainById } from "@treasury-copilot/shared";
import { fetchAttestation, resolveRoute, CctpUnsupportedError } from "@/lib/cctp";
import { genlayerWrite } from "@/lib/genlayerServer";
import { readPolicyRequest, readPolicyState, type RequestState } from "@/lib/apiServer";

/**
 * Completion stage for cross-chain payments.
 *
 * A CCTP burn leaves a request in `bridging`: the money has left the vault but the payee has not
 * been credited. This stage asks Circle whether the destination mint happened and only then marks
 * the request executed, so a request is never reported as paid before the payee can spend it.
 *
 * The three states are tracked independently, as the roadmap requires: the burn is already
 * recorded, the attestation is recorded here, and the destination transaction is what finally
 * closes the request.
 */

export type BridgeAdvanceOutcome =
  | { status: "completed"; requestId: string; destinationTxHash: Hex }
  | { status: "pending"; requestId: string; reason: string }
  | { status: "failed"; requestId: string; error: string };

export interface BridgeAdvanceDeps {
  fetchAttestationImpl?: typeof fetchAttestation;
  writeImpl?: typeof genlayerWrite;
}

/** Requests in this execution state are waiting on Circle rather than on the platform. */
export function isBridging(request: Pick<RequestState, "execution_status">): boolean {
  return request.execution_status === "bridging";
}

/**
 * Advance one bridging request.
 *
 * Idempotent by construction: a request whose destination transaction is already recorded returns
 * `completed` without writing again, so a duplicate cron worker cannot double-record.
 */
export async function advanceBridgedRequest(
  policy: Address,
  request: RequestState,
  settlementChainId: number,
  deps: BridgeAdvanceDeps = {},
): Promise<BridgeAdvanceOutcome> {
  const fetchImpl = deps.fetchAttestationImpl ?? fetchAttestation;
  const write = deps.writeImpl ?? genlayerWrite;
  const requestId = request.request_id;

  if (request.destination_tx_hash) {
    return { status: "completed", requestId, destinationTxHash: request.destination_tx_hash as Hex };
  }
  if (!request.bridge_tx_hash) {
    return { status: "failed", requestId, error: "request is bridging with no burn transaction recorded" };
  }

  const destinationChainId = Number(request.destination_chain_id ?? settlementChainId);
  let route;
  try {
    route = resolveRoute(settlementChainId, destinationChainId);
  } catch (error) {
    const stage = error instanceof CctpUnsupportedError ? error.stage : "route";
    return { status: "failed", requestId, error: `cannot resolve CCTP route (${stage})` };
  }

  const attestation = await fetchImpl(route, request.bridge_tx_hash as Hex);
  if (!attestation) {
    return { status: "pending", requestId, reason: "Circle has not indexed the burn yet" };
  }
  if (!attestation.complete || !attestation.forwardTxHash) {
    return {
      status: "pending",
      requestId,
      reason: `Circle reports ${attestation.status}${attestation.attestation ? " (attested, mint pending)" : ""}`,
    };
  }

  // Record the attestation and destination mint, then close the request. Ordering matters: if the
  // process dies between these writes, the request stays bridging with a destination hash stored,
  // and the early return above makes the retry a no-op rather than a double execution.
  await write(policy, "record_bridge_attested", [requestId, attestation.forwardTxHash]);
  await write(policy, "record_execution", [requestId, attestation.forwardTxHash]);
  return { status: "completed", requestId, destinationTxHash: attestation.forwardTxHash };
}

/** Scan a policy's requests and advance every bridging one. */
export async function advanceBridgedRequestsForPolicy(
  policy: Address,
  requestIds: string[],
  deps: BridgeAdvanceDeps = {},
): Promise<BridgeAdvanceOutcome[]> {
  const policyState = await readPolicyState(policy, "finalized");
  const settlementChainId = Number(policyState.evm_chain_id ?? 0);
  if (!chainById(settlementChainId)) return [];

  const outcomes: BridgeAdvanceOutcome[] = [];
  for (const rawId of requestIds) {
    const request = await readPolicyRequest(policy, rawId, "finalized");
    if (!isBridging(request)) continue;
    try {
      outcomes.push(await advanceBridgedRequest(policy, request, settlementChainId, deps));
    } catch (error) {
      outcomes.push({
        status: "failed",
        requestId: rawId,
        error: error instanceof Error ? error.message : "bridge advance failed",
      });
    }
  }
  return outcomes;
}
