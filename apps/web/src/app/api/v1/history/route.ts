import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, listPolicyRequests, readPolicyRequest, requestToApi } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);
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
