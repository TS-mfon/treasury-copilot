import { isAddress, isHex, type Address, type Hex } from "viem";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";

export const runtime = "nodejs";

const allowedPolicies = csvSet(process.env.ALLOWED_GENLAYER_POLICY_ADDRESSES ?? process.env.NEXT_PUBLIC_GENLAYER_POLICY);
const allowedChainIds = csvSet(process.env.ALLOWED_EVM_CHAIN_IDS ?? "84532,421614");

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid delegation registration payload");
  const body = value as Record<string, unknown>;
  const policy = body.policy;
  const chainId = Number(body.chainId);
  const delegatedAccount = body.delegatedAccount;
  const token = body.token;
  const permissionContext = body.permissionContext;
  const delegationPayload = body.delegationPayload;

  if (typeof policy !== "string" || !isAddress(policy)) throw new Error("Invalid policy address");
  if (!allowedPolicies.has(policy.toLowerCase())) throw new Error("policy not allowed");
  if (!Number.isInteger(chainId) || !allowedChainIds.has(String(chainId))) throw new Error("chain not allowed");
  if (typeof delegatedAccount !== "string" || !isAddress(delegatedAccount)) throw new Error("Invalid delegated account");
  if (typeof token !== "string" || !isAddress(token)) throw new Error("Invalid token address");
  if (typeof permissionContext !== "string" || !isHex(permissionContext, { strict: true })) throw new Error("Invalid permission context");
  if (!delegationPayload || typeof delegationPayload !== "object") throw new Error("Invalid delegation payload");

  return {
    policy: policy as Address,
    chainId,
    delegatedAccount: delegatedAccount as Address,
    token: token as Address,
    permissionContext: permissionContext as Hex,
    delegationPayload,
  };
}

export async function POST(request: Request) {
  try {
    const body = parseBody(await request.json());
    const serializedPayload = JSON.stringify(body.delegationPayload, (_, value) => (
      typeof value === "bigint" ? value.toString() : value
    ));
    const write = await genlayerWrite(body.policy, "register_delegation", [
      serializedPayload,
      body.delegatedAccount,
      body.token,
      body.permissionContext,
    ]);
    const policyState = await genlayerRead<Record<string, unknown>>(body.policy, "get_policy");
    return Response.json({ registered: true, policy: body.policy, chainId: body.chainId, write, policy_state: policyState });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Registration failed" }, { status: 400 });
  }
}
