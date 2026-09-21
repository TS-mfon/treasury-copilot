import { apiErrorResponse } from "@/lib/errors";
import { correlationId, pilotStoreHealth, requirePilotAdmin, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const owner = await requirePilotAdmin();
    const mongodb = await pilotStoreHealth();
    const checks = {
      application: "healthy",
      mongodb,
      genlayer: process.env.GENLAYER_RPC_URL || process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ? "configured" : "missing",
      registry: process.env.GENLAYER_REGISTRY || process.env.NEXT_PUBLIC_GENLAYER_REGISTRY ? "configured" : "missing",
      base_sepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ? "configured" : "default_chain_rpc",
      one_shot: process.env.ONE_SHOT_RELAYER_URL || process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL ? "configured" : "missing",
    } as const;
    return withCorrelation(Response.json({ owner, environment: "testnet", correlation_id: id, checks, status: Object.values(checks).some((value) => value === "missing" || value === "unavailable") ? "degraded" : "healthy" }, { headers: { "cache-control": "no-store" } }), id);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, id), id);
  }
}
