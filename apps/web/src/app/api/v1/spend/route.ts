import { after } from "next/server";
import type { Address, Hex } from "viem";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { chainToApi, parseSpendPayload, requestToApi, submitSpendThroughPolicy } from "@/lib/apiServer";
import { automaticallyReviewQueuedRequest } from "@/lib/automaticReview";
import { apiErrorResponse } from "@/lib/errors";
import {
  consumePilotRateLimit,
  correlationId,
  pilotRequestFromState,
  recordPilotRejection,
  recordPilotRequest,
  withCorrelation,
} from "@/lib/pilotStore";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestCorrelationId = correlationId(request);
  let claims: ReturnType<typeof verifyAgentApiKey> | undefined;
  try {
    const verifiedClaims = verifyAgentApiKey(bearerToken(request));
    claims = verifiedClaims;
    const keyLimit = await consumePilotRateLimit({ identifier: `key:${verifiedClaims.keyId}`, limit: 60, windowSeconds: 60 });
    const agentLimit = await consumePilotRateLimit({ identifier: `agent:${verifiedClaims.agent.toLowerCase()}`, limit: 180, windowSeconds: 60 });
    if (!keyLimit.allowed || !agentLimit.allowed) {
      return withCorrelation(Response.json({
        error: "rate_limited",
        message: "Testnet request rate exceeded. Retry after the supplied delay.",
        fields: {},
        request_id: requestCorrelationId,
        retryable: true,
      }, {
        status: 429,
        headers: { "retry-after": String(Math.max(keyLimit.retryAfter, agentLimit.retryAfter)), "cache-control": "no-store" },
      }), requestCorrelationId);
    }
    const payload = parseSpendPayload(await request.json());
    const result = await submitSpendThroughPolicy(verifiedClaims, payload);
    const apiRequest = requestToApi(result.requestState, verifiedClaims.tokenDecimals, verifiedClaims.chainId);
    const pilotRequest = pilotRequestFromState({
      claims: verifiedClaims,
      request: { ...result.requestState, ...apiRequest },
      correlationId: requestCorrelationId,
    });
    after(async () => {
      await recordPilotRequest(pilotRequest, result.idempotentReplay ? undefined : "request.accepted");
    });
    const requestUrl = `/api/v1/requests/${result.requestId}`;
    const status = result.idempotentReplay && result.requestState.finalized ? 200 : 202;
    if (status === 202 && Number(result.policy.contract_version ?? 0) < 5) {
      after(async () => {
        const automaticReview = await automaticallyReviewQueuedRequest(
          verifiedClaims.policy as Address,
          result.requestId as Hex,
        );
        if (automaticReview.outcome === "deferred_to_cron") {
          console.error("Automatic GenLayer review deferred to recovery cron", {
            policy: verifiedClaims.policy,
            requestId: result.requestId,
            attempts: automaticReview.attempts,
            error: automaticReview.error,
          });
        }
      });
    }
    return withCorrelation(Response.json({
      request_id: result.requestId,
      correlation_id: requestCorrelationId,
      environment: "testnet",
      verdict: result.requestState.verdict,
      reasoning: result.requestState.reasoning,
      status: result.requestState.execution_status,
      request: requestToApi(result.requestState, claims.tokenDecimals, claims.chainId),
      chain: chainToApi(verifiedClaims.chainId),
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
    }), requestCorrelationId);
  } catch (error) {
    after(async () => {
      await recordPilotRejection({
        correlationId: requestCorrelationId,
        owner: claims?.owner,
        agent: claims?.agent,
        policy: claims?.policy,
        error: error instanceof Error ? error.message : "Request failed",
      });
    });
    const response = apiErrorResponse(error, requestCorrelationId);
    return withCorrelation(response, requestCorrelationId);
  }
}
