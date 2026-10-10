import { getAddress, isAddress, type Address } from "viem";
import { genlayerRead } from "@/lib/genlayerServer";
import { listPolicyRequests, readPolicyRequest, requestToApi, type RegistryBinding } from "@/lib/apiServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";
// Every GenLayer read costs 1-3s and an owner can hold a dozen policies, so this route needs the
// same budget as the other GenLayer-backed routes. Without it the function was killed mid-scan and
// allSettled turned the timeout into an empty list, which the UI showed as "no requests found".
export const maxDuration = 300;

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
    // Read bindings first and drop revoked policies before paying for their requests. An owner
    // accumulates superseded policies on every re-registration, and scanning them was most of the
    // work for none of the results.
    const bindings = await Promise.allSettled(policies.map(async (policy) => ({
      policy,
      binding: await genlayerRead<RegistryBinding>(registry as Address, "get_policy", [policy]),
    })));

    const failures: Array<{ policy: string; error: string }> = [];
    bindings.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push({
          policy: policies[index],
          error: result.reason instanceof Error ? result.reason.message : "binding read failed",
        });
      }
    });

    const active = bindings
      .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
      .filter(({ binding }) => binding.active);

    const policyResults = await Promise.allSettled(active.map(async ({ policy, binding }) => {
      const ids = await listPolicyRequests(policy);
      const rows = await Promise.all(ids.map((id) => readPolicyRequest(policy, id)));
      return rows.map((row) => ({
        policy,
        // The registry binding already carries the agent, so the extra policy read is not needed.
        agent: binding.agent,
        owner,
        chain_id: Number(binding.chain_id),
        token: binding.token_address,
        token_symbol: binding.token_symbol,
        ...requestToApi(row, Number(binding.token_decimals), Number(binding.chain_id)),
      }));
    }));

    policyResults.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push({
          policy: active[index].policy,
          error: result.reason instanceof Error ? result.reason.message : "request read failed",
        });
      }
    });

    const requests = policyResults
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);

    // Surfaced rather than swallowed: an empty list must mean "no requests", never "the scan broke".
    return Response.json({
      owner,
      requests,
      scanned: { total: policies.length, active: active.length, failed: failures.length },
      failures,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load owner history" }, { status: 401 });
  }
}
