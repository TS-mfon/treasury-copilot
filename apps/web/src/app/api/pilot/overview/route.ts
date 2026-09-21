import { apiErrorResponse } from "@/lib/errors";
import { correlationId, pilotOverview, requirePilotAdmin, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const owner = await requirePilotAdmin();
    return withCorrelation(Response.json({ owner, environment: "testnet", ...await pilotOverview() }, { headers: { "cache-control": "no-store" } }), id);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, id), id);
  }
}
