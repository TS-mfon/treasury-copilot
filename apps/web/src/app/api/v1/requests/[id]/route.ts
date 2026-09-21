import { NextRequest, NextResponse } from "next/server";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, listPolicyRequests, readPolicyRequest, requestToApi } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";
import { correlationId, pilotRequestFromState, recordPilotRequestSafely, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestCorrelationId = correlationId(request);
  try {
    const { id } = await params;
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("Invalid request id");
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const ids = await listPolicyRequests(claims.policy);
    if (!ids.some((requestId) => requestId.toLowerCase() === id.toLowerCase())) {
      throw new Error("Request not found");
    }
    const row = await readPolicyRequest(claims.policy, id);
    const decimals = claims.tokenDecimals ?? 6;
    const formatted = requestToApi(row, decimals, claims.chainId);
    const pilotRequest = pilotRequestFromState({ claims, request: { ...row, ...formatted }, correlationId: requestCorrelationId });
    await recordPilotRequestSafely(pilotRequest);
    return withCorrelation(NextResponse.json(
      { policy: claims.policy, request: formatted },
      { status: 200 }
    ), requestCorrelationId);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, requestCorrelationId), requestCorrelationId);
  }
}
