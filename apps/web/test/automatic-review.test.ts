import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import {
  automaticallyReviewQueuedRequest,
} from "../src/lib/automaticReview";
import type { RequestState } from "../src/lib/apiServer";

const POLICY = "0xD384F2e4B1e29D463d541526eF277173B0d0aE10" as Address;
const REQUEST_ID = `0x${"11".repeat(32)}` as Hex;

function requestState(overrides: Partial<RequestState> = {}): RequestState {
  return {
    request_id: REQUEST_ID,
    recipient: "0x5905c9Dea6Ae52AA0947D8F7F218263889eDfC4E",
    amount_atto: "1000000",
    category: "subscription",
    justification: "Pay an approved subscription",
    evidence: [],
    evidence_digest: `0x${"22".repeat(32)}`,
    invoice_key: "",
    verdict: "pending",
    reasoning: "Awaiting review",
    tx_hash: "",
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    execution_status: "review_pending",
    execution_error: "",
    execution_claimed_at: "",
    finalized: false,
    ...overrides,
  };
}

test("automatic review waits for finalized queue state and then reviews once", async () => {
  let reads = 0;
  let reviews = 0;
  const result = await automaticallyReviewQueuedRequest(POLICY, REQUEST_ID, {
    readRequest: async () => {
      reads += 1;
      if (reads < 3) throw new Error("Request does not exist at finalized state");
      return requestState();
    },
    reviewRequest: async () => {
      reviews += 1;
      return requestState({
        verdict: "denied",
        finalized: true,
        execution_status: "not_applicable",
      });
    },
    sleep: async () => undefined,
    retryDelaysMs: [1, 1, 1],
  });

  assert.equal(result.outcome, "reviewed");
  assert.equal(result.attempts, 3);
  assert.equal(reviews, 1);
});

test("automatic review does not write after another worker resolves the request", async () => {
  let reviews = 0;
  const result = await automaticallyReviewQueuedRequest(POLICY, REQUEST_ID, {
    readRequest: async () => requestState({
      verdict: "approved",
      finalized: true,
      execution_status: "ready",
    }),
    reviewRequest: async () => {
      reviews += 1;
      return requestState();
    },
    retryDelaysMs: [],
  });

  assert.equal(result.outcome, "already_resolved");
  assert.equal(reviews, 0);
});

test("automatic review defers to cron after bounded queue-read failures", async () => {
  let reads = 0;
  const result = await automaticallyReviewQueuedRequest(POLICY, REQUEST_ID, {
    readRequest: async () => {
      reads += 1;
      throw new Error("GenLayer is temporarily busy");
    },
    reviewRequest: async () => {
      throw new Error("must not review");
    },
    sleep: async () => undefined,
    retryDelaysMs: [1, 1],
  });

  assert.equal(result.outcome, "deferred_to_cron");
  assert.equal(result.attempts, 3);
  assert.equal(reads, 3);
  assert.match(result.error ?? "", /temporarily busy/);
});

test("automatic review retries a transient review submission failure", async () => {
  let reviews = 0;
  const result = await automaticallyReviewQueuedRequest(POLICY, REQUEST_ID, {
    readRequest: async () => requestState(),
    reviewRequest: async () => {
      reviews += 1;
      if (reviews === 1) throw new Error("execution slots occupied");
      return requestState({
        verdict: "denied",
        finalized: true,
        execution_status: "not_applicable",
      });
    },
    sleep: async () => undefined,
    retryDelaysMs: [1],
  });

  assert.equal(result.outcome, "reviewed");
  assert.equal(reviews, 2);
});
