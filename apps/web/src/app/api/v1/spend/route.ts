import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { parseSpendPayload, requestToApi, submitSpendThroughPolicy } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const payload = parseSpendPayload(await request.json());
    const result = await submitSpendThroughPolicy(claims, payload);
    return Response.json({
      request_id: result.requestId,
      verdict: result.requestState.verdict,
      reasoning: result.requestState.reasoning,
      request: requestToApi(result.requestState, claims.tokenDecimals, claims.chainId),
      chain: null,
      genlayer: {
        request_tx_hash: result.submit.hash,
        record_execution_tx_hash: result.record?.hash ?? null,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
