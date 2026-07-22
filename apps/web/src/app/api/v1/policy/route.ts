import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertPolicyMatchesApiKey, assertRegistryBinding, readPolicyState } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const policy = await readPolicyState(claims.policy);
    assertPolicyMatchesApiKey(policy, claims);
    await assertRegistryBinding(claims);
    return Response.json({ policy: claims.policy, state: policy });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
