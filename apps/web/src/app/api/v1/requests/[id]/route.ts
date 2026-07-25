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
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("Invalid request id");
    const claims = verifyAgentApiKey(bearerToken(request));
    await assertRegistryBinding(claims);
    const row = await readPolicyRequest(claims.policy, id);
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
