import { after } from "next/server";
import type { Address, Hex } from "viem";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { chainToApi, parseSpendPayload, requestToApi, submitSpendThroughPolicy } from "@/lib/apiServer";
import { automaticallyReviewQueuedRequest } from "@/lib/automaticReview";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const payload = parseSpendPayload(await request.json());
    const result = await submitSpendThroughPolicy(claims, payload);
    const requestUrl = `/api/v1/requests/${result.requestId}`;
    const status = result.idempotentReplay && result.requestState.finalized ? 200 : 202;
    if (status === 202 && Number(result.policy.contract_version ?? 0) < 5) {
      after(async () => {
        const automaticReview = await automaticallyReviewQueuedRequest(
          claims.policy as Address,
          result.requestId as Hex,
        );
        if (automaticReview.outcome === "deferred_to_cron") {
          console.error("Automatic GenLayer review deferred to recovery cron", {
            policy: claims.policy,
            requestId: result.requestId,
            attempts: automaticReview.attempts,
            error: automaticReview.error,
          });
        }
      });
    }
    return Response.json({
      request_id: result.requestId,
      verdict: result.requestState.verdict,
      reasoning: result.requestState.reasoning,
      status: result.requestState.execution_status,
      request: requestToApi(result.requestState, claims.tokenDecimals, claims.chainId),
      chain: chainToApi(claims.chainId),
      idempotent_replay: result.idempotentReplay,
      poll_url: requestUrl,
      genlayer: {
        request_tx_hash: result.submit.hash,
      },
    }, {
      status,
      headers: {
        "cache-control": "no-store",
        location: requestUrl,
        ...(status === 202 ? { "retry-after": "10" } : {}),
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
