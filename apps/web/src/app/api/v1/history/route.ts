import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, listPolicyRequests, readPolicyRequest, requestToApi } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
    return Response.json({
      policy: claims.policy,
      agent: claims.agent,
      requests: rows.map((row) => requestToApi(row, claims.tokenDecimals, claims.chainId)),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
