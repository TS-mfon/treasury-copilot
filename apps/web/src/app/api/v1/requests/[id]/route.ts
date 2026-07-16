import { NextRequest, NextResponse } from "next/server";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertRegistryBinding, amountToUnits, readPolicyRequest, requestToApi } from "@/lib/apiServer";

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
    const formatted = requestToApi(row, decimals);
    return NextResponse.json(
      { policy: claims.policy, request: formatted },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request lookup failed" },
      { status: 400 }
    );
  }
}
