import { isAddress, isHex, type Address, type Hex } from "viem";
import { amountToUnits, readPolicyState, type RegistryBinding } from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";
import { hashActionPayload, verifyOwnerAction } from "@/lib/ownerActions";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

function registryAddress() {
  const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
  return registry as Address;
}

export async function PUT(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.policy !== "string" || !isAddress(body.policy)) throw new Error("A valid policy address is required");
    const policy = body.policy as Address;
    const state = await readPolicyState(policy);
    if (String(state.owner).toLowerCase() !== owner.toLowerCase()) throw new Error("This policy does not belong to the signed-in owner");
    const registry = registryAddress();
    const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [policy]);
    if (binding.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Registry ownership does not match the signed-in owner");
    const action = String(body.action ?? "update_policy");
    const nonce = BigInt(String(body.nonce ?? "-1"));
    const deadline = BigInt(String(body.deadline ?? "0"));
    const signature = body.owner_signature;
    if (nonce !== BigInt(String((state as Record<string, unknown>).policy_nonce ?? "0"))) throw new Error("Policy authorization nonce is stale");
    if (typeof signature !== "string" || !isHex(signature, { strict: true })) throw new Error("Owner authorization signature is required");
    if (!isAddress(String(state.authorized_agent)) || !isAddress(String(state.execution_reporter)) || !isAddress(String(state.token_address))) {
      throw new Error("Policy identity fields are invalid");
    }
    const chainId = Number(state.evm_chain_id);

    if (action === "set_whitelist_enabled") {
      if (typeof body.enabled !== "boolean") throw new Error("Whitelist enabled must be boolean");
      const payloadHash = hashActionPayload([body.enabled]);
      await verifyOwnerAction({
        registry,
        chainId,
        message: {
          owner,
          action,
          policy,
          agent: state.authorized_agent as Address,
          chainId: BigInt(chainId),
          token: state.token_address as Address,
          payloadHash,
          nonce,
          deadline,
        },
        signature: signature as Hex,
      });
      const write = await genlayerWrite(policy, "set_whitelist_enabled", [body.enabled, nonce]);
      return Response.json({ updated: true, policy, write, state: await readPolicyState(policy) });
    }

    if (action === "set_whitelist_entry") {
      if (typeof body.recipient !== "string" || !isAddress(body.recipient)) throw new Error("A valid whitelist recipient is required");
      if (typeof body.allowed !== "boolean") throw new Error("Whitelist allowed must be boolean");
      const recipient = body.recipient as Address;
      const payloadHash = hashActionPayload([recipient.toLowerCase(), body.allowed]);
      await verifyOwnerAction({
        registry,
        chainId,
        message: {
          owner,
          action,
          policy,
          agent: state.authorized_agent as Address,
          chainId: BigInt(chainId),
          token: state.token_address as Address,
          payloadHash,
          nonce,
          deadline,
        },
        signature: signature as Hex,
      });
      const write = await genlayerWrite(policy, "set_whitelist_entry", [recipient, body.allowed, nonce]);
      return Response.json({ updated: true, policy, write, state: await readPolicyState(policy) });
    }

    if (typeof body.policy_text !== "string" || body.policy_text.trim().length < 8) throw new Error("Policy text must be at least 8 characters");
    const decimals = Number(binding.token_decimals);
    const perTx = amountToUnits(String(body.per_tx_cap ?? ""), decimals);
    const weekly = amountToUnits(String(body.weekly_cap ?? ""), decimals);
    const threshold = amountToUnits(String(body.auto_approve_threshold ?? ""), decimals);
    if (threshold > perTx) throw new Error("Auto-approve threshold cannot exceed the per-request cap");
    if (perTx > weekly) throw new Error("Per-request cap cannot exceed the weekly cap");

    const payloadHash = hashActionPayload([
      perTx.toString(),
      weekly.toString(),
      threshold.toString(),
      body.policy_text.trim(),
    ]);
    await verifyOwnerAction({
      registry,
      chainId,
      message: {
        owner,
        action: "update_policy",
        policy,
        agent: state.authorized_agent as Address,
        chainId: BigInt(chainId),
        token: state.token_address as Address,
        payloadHash,
        nonce,
        deadline,
      },
      signature: signature as Hex,
    });

    const write = await genlayerWrite(policy, "update_policy", [
      state.authorized_agent,
      state.execution_reporter,
      perTx,
      weekly,
      threshold,
      body.policy_text.trim(),
      nonce,
    ]);
    return Response.json({ updated: true, policy, write, state: await readPolicyState(policy) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
