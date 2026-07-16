import { randomUUID } from "node:crypto";
import { isAddress, type Address } from "viem";
import { issueAgentApiKey } from "@/lib/apiAuth";
import { type RegistryBinding } from "@/lib/apiServer";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const { policy } = await request.json() as { policy?: string };
    if (!policy || !isAddress(policy)) throw new Error("A valid policy address is required");
    const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
    if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
    const before = await genlayerRead<RegistryBinding>(registry as Address, "get_policy", [policy]);
    if (before.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("This policy does not belong to the signed-in owner");
    const rotation = await genlayerWrite(registry as Address, "rotate_api_key", [policy]);
    const binding = await genlayerRead<RegistryBinding>(registry as Address, "get_policy", [policy]);
    const agent_api_key = issueAgentApiKey({
      keyId: randomUUID(),
      keyVersion: Number(binding.api_key_version ?? 1),
      owner: binding.owner as Address,
      agent: binding.agent as Address,
      policy: binding.policy as Address,
      delegatedAccount: binding.delegated_account as Address,
      chainId: Number(binding.chain_id),
      token: binding.token_address as Address,
      tokenSymbol: binding.token_symbol,
      tokenDecimals: Number(binding.token_decimals),
    });
    return Response.json({ agent_api_key, policy, key_version: binding.api_key_version, rotation });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not rotate agent API key" }, { status: 400 });
  }
}
