import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import {
  assertRegistryBinding,
  deriveRequestId,
  listPolicyRequests,
  readPolicyRequest,
  requestToApi,
} from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const idempotencyKey = new URL(request.url).searchParams.get("idempotency_key") ?? "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new Error("idempotency_key must be 8-128 characters using letters, numbers, dot, underscore, colon, or dash");
    }
    const requestId = deriveRequestId(claims, idempotencyKey);
    const ids = await listPolicyRequests(claims.policy);
    if (!ids.some((id) => id.toLowerCase() === requestId.toLowerCase())) {
      return Response.json({
        request_id: requestId,
        status: "not_found_or_pending",
        message: "The request is not visible on GenLayer yet. Retry the original POST with the same idempotency key; never create a replacement key for the same payment.",
        retryable: true,
      }, {
        status: 202,
        headers: { "cache-control": "no-store", "retry-after": "10" },
      });
    }
    const row = await readPolicyRequest(claims.policy, requestId);
    return Response.json({
      policy: claims.policy,
      idempotency_key: idempotencyKey,
      request: requestToApi(row, claims.tokenDecimals, claims.chainId),
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
