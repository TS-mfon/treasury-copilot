import { randomUUID } from "node:crypto";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { issueAgentApiKey } from "@/lib/apiAuth";
import { apiErrorResponse } from "@/lib/errors";
import { type RegistryBinding } from "@/lib/apiServer";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";
import { hashActionPayload, verifyOwnerAction } from "@/lib/ownerActions";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

function registryAddress() {
  const value = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!value || !isAddress(value)) throw new Error("Treasury registry is not configured");
  return value as Address;
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const body = await request.json() as Record<string, unknown>;
    const policy = body.policy;
    const action = body.action === "revoke" ? "revoke_agent_key" : "rotate_agent_key";
    const deadline = BigInt(String(body.deadline ?? "0"));
    const signature = body.owner_signature;
    if (typeof policy !== "string" || !isAddress(policy)) throw new Error("A valid policy address is required");
    if (typeof signature !== "string" || !isHex(signature, { strict: true })) throw new Error("Owner authorization signature is required");

    const registry = registryAddress();
    const before = await genlayerRead<RegistryBinding>(registry, "get_policy", [policy]);
    if (before.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("This policy does not belong to the signed-in owner");
    const nonce = BigInt(before.api_key_version ?? "1");
    const payloadHash = hashActionPayload([action, policy.toLowerCase(), nonce.toString()]);
    await verifyOwnerAction({
      registry,
      chainId: Number(before.chain_id),
      message: {
        owner,
        action,
        policy: policy as Address,
        agent: before.agent as Address,
        chainId: BigInt(before.chain_id),
        token: before.token_address as Address,
        payloadHash,
        nonce,
        deadline,
      },
      signature: signature as Hex,
    });

    if (action === "revoke_agent_key") {
      const write = await genlayerWrite(registry, "set_policy_active", [policy, false]);
      return Response.json({ revoked: true, policy, write });
    }

    const rotation = await genlayerWrite(registry, "rotate_api_key", [policy]);
    const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [policy]);
    const agentApiKey = issueAgentApiKey({
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
    return Response.json({ agent_api_key: agentApiKey, policy, key_version: binding.api_key_version, rotation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
