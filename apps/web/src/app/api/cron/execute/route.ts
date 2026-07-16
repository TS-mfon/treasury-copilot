import { timingSafeEqual } from "node:crypto";
import { isAddress, type Address, type Hex } from "viem";
import { executeApprovedPolicyRequest, listPolicyRequests, readPolicyRequest } from "@/lib/apiServer";
import { genlayerRead } from "@/lib/genlayerServer";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret) throw new Error("CRON_SECRET is not configured");
  const left = Buffer.from(received);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
    if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
    const policies = await genlayerRead<string[]>(registry as Address, "list_policies");
    const completed: string[] = [];
    const failed: Array<{ request_id: string; error: string }> = [];
    for (const rawPolicy of policies.slice(0, 50)) {
      if (!isAddress(rawPolicy)) continue;
      const policy = rawPolicy as Address;
      const requestIds = await listPolicyRequests(policy);
      for (const rawRequestId of requestIds.slice(-25)) {
        const requestState = await readPolicyRequest(policy, rawRequestId);
        if (requestState.verdict !== "approved" || requestState.tx_hash || !["ready", "failed", "approved_pending_execution"].includes(requestState.execution_status ?? "")) continue;
        try {
          const result = await executeApprovedPolicyRequest(policy, rawRequestId as Hex);
          completed.push(result.requestId);
        } catch (error) {
          failed.push({ request_id: rawRequestId, error: error instanceof Error ? error.message : "Execution failed" });
        }
      }
    }
    return Response.json({ completed, failed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cron execution failed" }, { status: 500 });
  }
}
