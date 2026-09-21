import { apiErrorResponse } from "@/lib/errors";
import { correlationId, listPilotRequests, requirePilotAdmin, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const owner = await requirePilotAdmin();
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? 25);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
    const result = await listPilotRequests({
      limit,
      owner: url.searchParams.get("owner") || undefined,
      status: url.searchParams.get("status") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
    });
    return withCorrelation(Response.json({ owner, environment: "testnet", correlation_id: id, ...result }, { headers: { "cache-control": "no-store" } }), id);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, id), id);
  }
}
