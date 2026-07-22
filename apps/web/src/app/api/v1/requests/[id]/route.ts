import { NextRequest, NextResponse } from "next/server";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, readPolicyRequest, requestToApi } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const row = await readPolicyRequest(claims.policy, id);
    if (!row) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    const decimals = claims.tokenDecimals ?? 6;
    const formatted = requestToApi(row, decimals, claims.chainId);
    return NextResponse.json(
      { policy: claims.policy, request: formatted },
      { status: 200 }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
