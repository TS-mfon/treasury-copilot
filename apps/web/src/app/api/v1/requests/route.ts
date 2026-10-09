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
      // Previously this returned 202 + retryable:true with a synthesized request_id, which told an
      // agent to poll forever for a record that may never exist, and handed it a payment id for a
      // payment that was never accepted. There is no record here, so say exactly that: polling this
      // endpoint cannot make one appear. Re-sending the original POST with the same key is the one
      // safe action, and it is idempotent, so it is named instead of a retry loop.
      return Response.json({
        error: "no_record",
        status: "no_record",
        // Derived from the idempotency key, not read from GenLayer. Named so it cannot be mistaken
        // for a real on-chain record.
        derived_request_id: requestId,
        policy: claims.policy,
        idempotency_key: idempotencyKey,
        message: "GenLayer holds no request for this idempotency key, so either the submission was never accepted or it was rejected before reaching the policy. Re-send the original POST once with the same idempotency key; that is idempotent and will not double-pay. Do not poll this endpoint waiting for the record to appear.",
        retryable: false,
        fields: {},
      }, {
        status: 404,
        headers: { "cache-control": "no-store" },
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
