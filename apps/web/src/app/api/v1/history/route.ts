import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, listPolicyRequests, readPolicyRequest, requestToApi } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";
import { correlationId, pilotRequestFromState, recordPilotRequestSafely, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestCorrelationId = correlationId(request);
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const parsedLimit = rawLimit === null ? 25 : Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new Error("History limit must be an integer from 1 to 100");
    }
    const limit = parsedLimit;
    const ids = await listPolicyRequests(claims.policy);
    const selected = ids.slice(Math.max(ids.length - limit, 0)).reverse();
    const rows = await Promise.all(selected.map((id) => readPolicyRequest(claims.policy, id)));
    await Promise.all(rows.map((row) => recordPilotRequestSafely(pilotRequestFromState({
      claims,
      request: { ...row, ...requestToApi(row, claims.tokenDecimals, claims.chainId) },
      correlationId: requestCorrelationId,
    }))));
    return withCorrelation(Response.json({
      policy: claims.policy,
      agent: claims.agent,
      requests: rows.map((row) => requestToApi(row, claims.tokenDecimals, claims.chainId)),
      correlation_id: requestCorrelationId,
      environment: "testnet",
    }), requestCorrelationId);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, requestCorrelationId), requestCorrelationId);
  }
}
