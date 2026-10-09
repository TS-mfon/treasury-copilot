import { isAddress, type Address } from "viem";
import { apiErrorResponse } from "@/lib/errors";
import { requireOwnerSession } from "@/lib/ownerSession";
import { agentLabelsForOwner, setAgentLabel } from "@/lib/pilotStore";

export const runtime = "nodejs";

/**
 * Owner-chosen names for agent policies.
 *
 * Display metadata only. It is scoped to the calling owner so one owner cannot rename another's
 * agent, and it never participates in authorization — a policy is authorized by its on-chain
 * registry binding, not by what it is called.
 */
export async function GET() {
  try {
    const owner = await requireOwnerSession();
    return Response.json({ labels: await agentLabelsForOwner(owner) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const body = await request.json() as Record<string, unknown>;
    const policy = body.policy;
    const label = body.label;

    if (typeof policy !== "string" || !isAddress(policy)) {
      throw new Error("A valid policy address is required");
    }
    if (typeof label !== "string" || label.trim().length < 1 || label.trim().length > 64) {
      throw new Error("label must be 1-64 characters");
    }

    const stored = await setAgentLabel({ policy: policy as Address, owner, label: label.trim() });
    if (!stored) {
      // No durable store configured. Say so plainly rather than reporting a save that did not happen.
      return Response.json({
        error: "label_store_unavailable",
        message: "Agent names need the durable pilot store. Set MONGODB_URI to keep them.",
        fields: {},
        retryable: false,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ policy, label: label.trim() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
