import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { formatUnits } from "viem";
import { chainToApi, parseSpendPayload, requestToApi, submitSpendThroughPolicy } from "@/lib/apiServer";
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
      chain: chainToApi(claims.chainId),
      idempotent_replay: result.idempotentReplay,
      execution: result.execution ? {
        mode: result.execution.execution.mode,
        task_id: result.execution.execution.task_id ?? null,
        fee_amount_units: result.execution.execution.fee_amount_units ?? null,
        fee_amount: result.execution.execution.fee_amount_units
          ? formatUnits(BigInt(result.execution.execution.fee_amount_units), claims.tokenDecimals)
          : null,
      } : null,
      genlayer: {
        request_tx_hash: result.submit.hash,
        record_execution_tx_hash: result.record?.hash ?? null,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
