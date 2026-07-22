import { randomUUID } from "node:crypto";
import {
  isAddress,
  isHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  chainById,
  tokenForChainId,
  type SupportedTokenSymbol,
} from "@treasury-copilot/shared";
import { issueAgentApiKey } from "@/lib/apiAuth";
import {
  amountToUnits,
  platformAccount,
  readPolicyState,
  type RegistryBinding,
} from "@/lib/apiServer";
import { apiErrorResponse } from "@/lib/errors";
import {
  deployTreasuryPolicy,
  genlayerRead,
  genlayerWrite,
} from "@/lib/genlayerServer";
import { canonicalJson, hashActionPayload, verifyOwnerAction } from "@/lib/ownerActions";
import { requireOwnerSession } from "@/lib/ownerSession";
import { assertStoredDelegation, validateDelegationGrant } from "@/lib/delegationValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

function registryAddress() {
  const value = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!value || !isAddress(value)) throw new Error("Treasury registry is not configured");
  return value as Address;
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid setup payload");
  const body = value as Record<string, unknown>;
  const agent = body.agent;
  const delegatedAccount = body.delegated_account ?? body.delegatedAccount;
  const chainId = Number(body.chain_id ?? body.chainId);
  const tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? "USDC").toUpperCase() as SupportedTokenSymbol;
  const permissionContext = body.permission_context ?? body.permissionContext;
  const delegationPayload = body.delegation_payload ?? body.delegationPayload;
  const perTxCap = body.per_tx_cap ?? body.perTxCap;
  const weeklyCap = body.weekly_cap ?? body.weeklyCap;
  const threshold = body.auto_approve_threshold ?? body.autoApproveThreshold;
  const policyText = body.policy_text ?? body.policyText;
  const whitelist = body.whitelist ?? "";
  const nonce = BigInt(String(body.nonce ?? "-1"));
  const deadline = BigInt(String(body.deadline ?? "0"));
  const signature = body.owner_signature ?? body.ownerSignature;

  if (typeof agent !== "string" || !isAddress(agent)) throw new Error("Invalid agent address");
  if (typeof delegatedAccount !== "string" || !isAddress(delegatedAccount)) throw new Error("Invalid delegated account");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id");
  if (chainId !== 84532) throw new Error("Unsupported chain: automatic execution is currently available only on Base Sepolia");
  if (tokenSymbol !== "USDC") throw new Error("Unsupported token: automatic execution currently supports USDC only");
  if (typeof permissionContext !== "string" || !isHex(permissionContext, { strict: true })) throw new Error("Invalid permission context");
  if (!delegationPayload || typeof delegationPayload !== "object") throw new Error("Invalid delegation payload");
  if (typeof policyText !== "string" || policyText.trim().length < 8) throw new Error("Policy text must be at least 8 characters");
  if (typeof whitelist !== "string") throw new Error("Whitelist must be a comma-separated string");
  if (nonce < 0n || deadline <= 0n) throw new Error("Owner authorization nonce and deadline are required");
  if (typeof signature !== "string" || !isHex(signature, { strict: true })) throw new Error("Owner authorization signature is required");

  return {
    agent: agent as Address,
    delegatedAccount: delegatedAccount as Address,
    chainId,
    tokenSymbol,
    permissionContext: permissionContext as Hex,
    delegationPayload,
    perTxCap: String(perTxCap ?? ""),
    weeklyCap: String(weeklyCap ?? ""),
    threshold: String(threshold ?? ""),
    policyText: policyText.trim(),
    whitelist: whitelist.trim(),
    nonce,
    deadline,
    signature: signature as Hex,
  };
}

async function matchingPolicy(owner: Address, body: ReturnType<typeof parseBody>, token: Address) {
  const registry = registryAddress();
  const policies = await genlayerRead<string[]>(registry, "policies_for_owner", [owner]);
  const legacyPolicies: Address[] = [];
  for (const policy of policies) {
    if (!isAddress(policy)) continue;
    const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [policy]);
    if (
      binding.active
      && binding.owner.toLowerCase() === owner.toLowerCase()
      && binding.agent.toLowerCase() === body.agent.toLowerCase()
      && binding.delegated_account.toLowerCase() === body.delegatedAccount.toLowerCase()
      && binding.token_address.toLowerCase() === token.toLowerCase()
      && Number(binding.chain_id) === body.chainId
    ) {
      const policyAddress = policy as Address;
      const state = await readPolicyState(policyAddress);
      if (state.contract_version === "2") {
        return { policy: policyAddress, legacyPolicies };
      }
      legacyPolicies.push(policyAddress);
    }
  }
  return { policy: undefined, legacyPolicies };
}

export async function GET() {
  try {
    const owner = await requireOwnerSession();
    const registry = registryAddress();
    const nonce = await genlayerRead<string>(registry, "owner_nonce", [owner]);
    return Response.json({ owner, registry, nonce });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwnerSession();
    const body = parseBody(await request.json());
    const chain = chainById(body.chainId);
    if (!chain) throw new Error("Unsupported chain id");
    const token = tokenForChainId(body.chainId, body.tokenSymbol);
    if (!token.address) throw new Error("USDC is not configured for Base Sepolia");

    const perTx = amountToUnits(body.perTxCap, token.decimals);
    const weekly = amountToUnits(body.weeklyCap, token.decimals);
    const threshold = amountToUnits(body.threshold, token.decimals);
    if (threshold > perTx) throw new Error("Auto-approve threshold cannot exceed the per-request cap");
    if (perTx > weekly) throw new Error("Per-request cap cannot exceed the weekly cap");

    const platform = platformAccount().address;
    const validatedGrant = validateDelegationGrant(body.delegationPayload, {
      owner,
      platformDelegate: platform,
      chainId: body.chainId,
      token: token.address,
      weeklyAllowanceAtto: weekly,
      permissionContext: body.permissionContext,
    });
    if (validatedGrant.delegatedAccount.toLowerCase() !== body.delegatedAccount.toLowerCase()) {
      throw new Error("Delegated account does not match the approved wallet grant");
    }
    const serializedDelegation = canonicalJson(body.delegationPayload);
    const payloadHash = hashActionPayload([
      body.agent.toLowerCase(),
      body.delegatedAccount.toLowerCase(),
      body.chainId,
      token.address.toLowerCase(),
      body.tokenSymbol,
      body.permissionContext,
      serializedDelegation,
      perTx.toString(),
      weekly.toString(),
      threshold.toString(),
      body.policyText,
      body.whitelist,
    ]);
    const registry = registryAddress();
    const currentNonce = BigInt(await genlayerRead<string>(registry, "owner_nonce", [owner]));
    if (body.nonce !== currentNonce) throw new Error("Owner setup authorization nonce is stale");

    await verifyOwnerAction({
      registry,
      chainId: body.chainId,
      message: {
        owner,
        action: "setup_agent",
        policy: zeroAddress,
        agent: body.agent,
        chainId: BigInt(body.chainId),
        token: token.address,
        payloadHash,
        nonce: body.nonce,
        deadline: body.deadline,
      },
      signature: body.signature,
    });

    const match = await matchingPolicy(owner, body, token.address);
    let policy = match.policy;
    let deployment: Awaited<ReturnType<typeof deployTreasuryPolicy>> | null = null;

    if (!policy) {
      deployment = await deployTreasuryPolicy([
        registry,
        owner,
        body.agent,
        platform,
        body.delegatedAccount,
        token.address,
        body.permissionContext,
        "",
        body.chainId,
        perTx,
        weekly,
        threshold,
        body.policyText,
        body.whitelist,
      ]);
      policy = deployment.address;
      await genlayerWrite(registry, "register_policy", [
        owner,
        body.agent,
        policy,
        body.chainId,
        body.delegatedAccount,
        token.address,
        token.symbol,
        token.decimals,
        body.nonce,
      ]);
      for (const legacyPolicy of match.legacyPolicies) {
        await genlayerWrite(registry, "set_policy_active", [legacyPolicy, false]);
      }
    } else {
      const currentPolicy = await readPolicyState(policy);
      await genlayerWrite(policy, "update_policy", [
        body.agent,
        platform,
        perTx,
        weekly,
        threshold,
        body.policyText,
        BigInt(String(currentPolicy.policy_nonce ?? "0")),
      ]);
      await genlayerWrite(registry, "consume_owner_nonce", [
        owner,
        body.nonce,
      ]);
    }

    const delegationWrite = await genlayerWrite(policy, "register_delegation", [
      serializedDelegation,
      body.delegatedAccount,
      token.address,
      body.permissionContext,
    ]);
    const storedPolicy = await readPolicyState(policy);
    assertStoredDelegation(storedPolicy as Record<string, unknown>, {
      delegatedAccount: body.delegatedAccount,
      token: token.address,
      permissionContext: body.permissionContext,
      serializedPayload: serializedDelegation,
    });

    const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [policy]);
    const agentApiKey = issueAgentApiKey({
      keyId: randomUUID(),
      keyVersion: Number(binding.api_key_version ?? 1),
      owner,
      agent: body.agent,
      policy,
      delegatedAccount: body.delegatedAccount,
      chainId: body.chainId,
      token: token.address,
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
    });

    return Response.json({
      agent_api_key: agentApiKey,
      agent: body.agent,
      owner,
      policy,
      chain_id: body.chainId,
      chain: chain.name,
      token_symbol: token.symbol,
      token_decimals: token.decimals,
      deployment_tx_hash: deployment?.hash ?? null,
      delegation_tx_hash: delegationWrite.hash,
      delegation_registered: true,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
