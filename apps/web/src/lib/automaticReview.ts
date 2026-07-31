import type { Address, Hex } from "viem";
import {
  readPolicyRequest,
  reviewQueuedPolicyRequest,
  type RequestState,
} from "@/lib/apiServer";

const DEFAULT_RETRY_DELAYS_MS = [3_000, 5_000, 8_000, 13_000, 16_000] as const;

type AutomaticReviewDependencies = {
  readRequest?: (policy: Address, requestId: Hex) => Promise<RequestState>;
  reviewRequest?: (policy: Address, requestId: Hex) => Promise<RequestState>;
  sleep?: (delayMs: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
};

export type AutomaticReviewResult = {
  outcome: "reviewed" | "already_resolved" | "deferred_to_cron";
  request?: RequestState;
  attempts: number;
  error?: string;
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function automaticallyReviewQueuedRequest(
  policy: Address,
  requestId: Hex,
  dependencies: AutomaticReviewDependencies = {},
): Promise<AutomaticReviewResult> {
  const readRequest = dependencies.readRequest
    ?? ((targetPolicy, targetRequestId) => readPolicyRequest(targetPolicy, targetRequestId, "finalized"));
  const reviewRequest = dependencies.reviewRequest ?? reviewQueuedPolicyRequest;
  const sleep = dependencies.sleep
    ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const retryDelaysMs = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let lastError = "";

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const request = await readRequest(policy, requestId);
      if (request.verdict !== "pending" || request.execution_status !== "review_pending") {
        return { outcome: "already_resolved", request, attempts: attempt + 1 };
      }

      // reviewQueuedPolicyRequest performs another finalized read immediately
      // before writing, so a competing recovery worker cannot bypass the
      // contract's pending + review_pending state guard.
      const reviewed = await reviewRequest(policy, requestId);
      return { outcome: "reviewed", request: reviewed, attempts: attempt + 1 };
    } catch (error) {
      lastError = message(error);
      const delay = retryDelaysMs[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }

  return {
    outcome: "deferred_to_cron",
    attempts: retryDelaysMs.length + 1,
    error: lastError || "The queued request did not become readable at finalized state",
  };
}
