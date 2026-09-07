import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    application: "healthy",
    genlayer: process.env.GENLAYER_RPC_URL || process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ? "configured" : "missing",
    registry: process.env.GENLAYER_REGISTRY || process.env.NEXT_PUBLIC_GENLAYER_REGISTRY ? "configured" : "missing",
    base_sepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ? "configured" : "missing",
    one_shot: process.env.ONE_SHOT_RELAYER_URL || process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL ? "configured" : "missing",
  } as const;
  const healthy = Object.values(checks).every((value) => value !== "missing");
  return NextResponse.json({
    status: healthy ? "healthy" : "degraded",
    environment: "testnet",
    checked_at: new Date().toISOString(),
    checks,
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
