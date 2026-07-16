import { randomUUID } from "node:crypto";
import { isAddress, verifyMessage, type Address } from "viem";
import { chainById, tokenForChainId, type SupportedTokenSymbol } from "@treasury-copilot/shared";
import { issueAgentApiKey } from "@/lib/apiAuth";
import { readPolicyState } from "@/lib/apiServer";
import { genlayerWrite } from "@/lib/genlayerServer";

export const runtime = "nodejs";

function parseBody(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid setup payload");
  const body = value as Record<string, unknown>;
  const owner = body.owner;
  const agent = body.agent;
  const policy = body.policy;
  const delegatedAccount = body.delegated_account ?? body.delegatedAccount;
  const chainId = Number(body.chain_id ?? body.chainId);
  const tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? "USDC").toUpperCase() as SupportedTokenSymbol;
  const ownerMessage = body.owner_message ?? body.ownerMessage;
  const ownerSignature = body.owner_signature ?? body.ownerSignature;

  if (typeof owner !== "string" || !isAddress(owner)) throw new Error("Invalid owner address");
  if (typeof agent !== "string" || !isAddress(agent)) throw new Error("Invalid agent address");
  if (typeof policy !== "string" || !isAddress(policy)) throw new Error("Invalid policy address");
  if (typeof delegatedAccount !== "string" || !isAddress(delegatedAccount)) throw new Error("Invalid delegated account");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id");
  if (tokenSymbol !== "USDC" && tokenSymbol !== "OKB") throw new Error("Unsupported token symbol");
  if (typeof ownerMessage !== "string" || !ownerMessage.includes(policy)) throw new Error("Owner authorization message is required");
  if (typeof ownerSignature !== "string") throw new Error("Owner signature is required");

  return {
    owner: owner as Address,
    agent: agent as Address,
    policy: policy as Address,
    delegatedAccount: delegatedAccount as Address,
    chainId,
    tokenSymbol,
    ownerMessage,
    ownerSignature: ownerSignature as `0x${string}`,
  };
}

export async function POST(request: Request) {
  try {
    const body = parseBody(await request.json());
    const ok = await verifyMessage({ address: body.owner, message: body.ownerMessage, signature: body.ownerSignature });
    if (!ok) throw new Error("Owner signature is invalid");
    const chain = chainById(body.chainId);
    if (!chain) throw new Error("Unsupported chain id");
    const token = tokenForChainId(body.chainId, body.tokenSymbol);
    const policy = await readPolicyState(body.policy);
    if (String(policy.owner ?? "").toLowerCase() !== body.owner.toLowerCase()) throw new Error("Owner does not match policy");
    if (String(policy.authorized_agent ?? "").toLowerCase() !== body.agent.toLowerCase()) throw new Error("Agent does not match policy");
    if (String(policy.delegated_account ?? "").toLowerCase() !== body.delegatedAccount.toLowerCase()) throw new Error("Delegated account does not match policy");
    if (String(policy.token_address ?? "").toLowerCase() !== token.address?.toLowerCase()) throw new Error("Token does not match policy");
    if (String(policy.evm_chain_id ?? "") !== String(body.chainId)) throw new Error("Chain does not match policy");

    const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
    if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
    // Registration is idempotent from the product perspective: an existing policy is
    // already bound on-chain, while a new policy is written by the platform signer
    // only after the owner signature above has been verified.
    try {
      await genlayerWrite(registry as Address, "register_policy", [
        body.owner,
        body.agent,
        body.policy,
        body.chainId.toString(),
        body.delegatedAccount,
        token.address as Address,
        token.symbol,
        token.decimals.toString(),
      ]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("already registered")) throw error;
    }

    const agent_api_key = issueAgentApiKey({
      keyId: randomUUID(),
      keyVersion: 1,
      owner: body.owner,
      agent: body.agent,
      policy: body.policy,
      delegatedAccount: body.delegatedAccount,
      chainId: body.chainId,
      token: token.address as Address,
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
    });

    return Response.json({
      agent_api_key,
      agent: body.agent,
      owner: body.owner,
      policy: body.policy,
      delegated_account: body.delegatedAccount,
      chain_id: body.chainId,
      chain: chain.name,
      token: token.address,
      token_symbol: token.symbol,
      token_decimals: token.decimals,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Setup failed" }, { status: 400 });
  }
}
