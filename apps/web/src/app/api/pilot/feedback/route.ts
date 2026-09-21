import { apiErrorResponse } from "@/lib/errors";
import { consumePilotRateLimit, correlationId, recordPilotFeedback, withCorrelation } from "@/lib/pilotStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = await consumePilotRateLimit({ identifier: `feedback:${client}`, limit: 10, windowSeconds: 3600 });
    if (!limit.allowed) {
      return withCorrelation(Response.json({ error: "rate_limited", message: "Feedback rate exceeded", retryable: true }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } }), id);
    }
    const body = await request.json() as Record<string, unknown>;
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const severity = body.severity === "high" || body.severity === "medium" ? body.severity : "low";
    if (!category || category.length > 80 || !description || description.length > 2000) {
      throw new Error("Feedback category and description are required and must be within limits");
    }
    const result = await recordPilotFeedback({
      category,
      severity,
      description,
      request_id: typeof body.request_id === "string" ? body.request_id.slice(0, 100) : undefined,
      correlation_id: typeof body.correlation_id === "string" ? body.correlation_id.slice(0, 100) : id,
      tester: typeof body.tester === "string" ? body.tester.slice(0, 120) : undefined,
    });
    return withCorrelation(Response.json({ ...result, correlation_id: id, environment: "testnet" }, { status: 201, headers: { "cache-control": "no-store" } }), id);
  } catch (error) {
    return withCorrelation(apiErrorResponse(error, id), id);
  }
}
