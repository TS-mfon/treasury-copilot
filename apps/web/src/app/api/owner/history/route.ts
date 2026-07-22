import { getAddress, isAddress, type Address } from "viem";
import { genlayerRead } from "@/lib/genlayerServer";
import { listPolicyRequests, readPolicyRequest, requestToApi, type RegistryBinding } from "@/lib/apiServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
    if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50), 1), 100);
    const policies = [...new Map(
      (await genlayerRead<string[]>(registry as Address, "policies_for_owner", [owner]))
        .filter((policy) => isAddress(policy, { strict: false }))
        .map((policy) => [policy.toLowerCase(), getAddress(policy)]),
    ).values()];
    const policyResults = await Promise.allSettled(policies.map(async (policy) => {
      const state = await genlayerRead<Record<string, string>>(policy, "get_policy");
      const binding = await genlayerRead<RegistryBinding>(registry as Address, "get_policy", [policy]);
      const ids = await listPolicyRequests(policy);
      const rows = await Promise.all(ids.map((id) => readPolicyRequest(policy, id)));
      return rows.map((row) => ({
        policy,
        agent: state.authorized_agent,
        owner,
        chain_id: Number(binding.chain_id),
        token: binding.token_address,
        token_symbol: binding.token_symbol,
        ...requestToApi(row, Number(binding.token_decimals), Number(binding.chain_id)),
      }));
    }));
    const requests = policyResults
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    return Response.json({ owner, requests });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load owner history" }, { status: 401 });
  }
}
