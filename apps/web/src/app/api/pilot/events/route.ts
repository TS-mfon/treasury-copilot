import { apiErrorResponse } from "@/lib/errors";
import { correlationId, listPilotEvents, requirePilotAdmin, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const owner = await requirePilotAdmin();
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const result = await listPilotEvents(limit, url.searchParams.get("cursor") || undefined);
    return withCorrelation(Response.json({ owner, environment: "testnet", correlation_id: id, ...result }, { headers: { "cache-control": "no-store" } }), id);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, id), id);
  }
}
