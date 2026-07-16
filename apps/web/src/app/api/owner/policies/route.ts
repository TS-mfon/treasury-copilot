import { isAddress, type Address } from "viem";
import { genlayerRead } from "@/lib/genlayerServer";
import { readPolicyState } from "@/lib/apiServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

export async function GET() {
  try {
    const owner = await requireOwnerSession();
    const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
    if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
    const policies = await genlayerRead<string[]>(registry as Address, "policies_for_owner", [owner]);
    const uniquePolicies = [...new Set(policies.map((policy) => policy.toLowerCase()))];
    const rows = await Promise.all(uniquePolicies.map(async (policy) => ({ policy, state: await readPolicyState(policy as Address) })));
    return Response.json({ owner, policies: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load owner policies" }, { status: 401 });
  }
}
