import { isAddress, type Address } from "viem";
import { amountToUnits, readPolicyState } from "@/lib/apiServer";
import { genlayerWrite } from "@/lib/genlayerServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.policy !== "string" || !isAddress(body.policy)) throw new Error("A valid policy address is required");
    const state = await readPolicyState(body.policy as Address);
    if (String(state.owner).toLowerCase() !== owner.toLowerCase()) throw new Error("This policy does not belong to the signed-in owner");
    if (typeof body.policy_text !== "string" || body.policy_text.trim().length < 8) throw new Error("Policy text must be at least 8 characters");
    const decimals = Number(body.token_decimals ?? 6);
    const perTx = amountToUnits(String(body.per_tx_cap ?? ""), decimals);
    const weekly = amountToUnits(String(body.weekly_cap ?? ""), decimals);
    const threshold = amountToUnits(String(body.auto_approve_threshold ?? ""), decimals);
    if (threshold > perTx) throw new Error("Auto-approve threshold cannot exceed the per-request cap");
    const write = await genlayerWrite(body.policy as Address, "update_policy", [state.authorized_agent, state.execution_reporter, perTx.toString(), weekly.toString(), threshold.toString(), body.policy_text.trim()]);
    return Response.json({ updated: true, policy: body.policy, write, state: await readPolicyState(body.policy as Address) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy update failed" }, { status: 400 });
  }
}
