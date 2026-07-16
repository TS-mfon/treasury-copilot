import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { parseSpendPayload, requestToApi, submitSpendThroughPolicy } from "@/lib/apiServer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const payload = parseSpendPayload(await request.json());
    const result = await submitSpendThroughPolicy(claims, payload);
    return Response.json({
      request_id: result.requestId,
      verdict: result.requestState.verdict,
      reasoning: result.requestState.reasoning,
      request: requestToApi(result.requestState, claims.tokenDecimals),
      chain: null,
      genlayer: {
        request_tx_hash: result.submit.hash,
        record_execution_tx_hash: null,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Spend request failed" }, { status: 400 });
  }
}
