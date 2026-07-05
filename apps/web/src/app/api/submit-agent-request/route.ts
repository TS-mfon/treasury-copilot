import { isAddress, isHex, keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTreasuryRequestDomain, treasuryRequestTypes, type TreasuryRequestMessage } from "@treasury-copilot/shared";

export const runtime = "nodejs";

const rpcUrl = process.env.GENLAYER_RPC_URL ?? process.env.NEXT_PUBLIC_GENLAYER_RPC_URL;
const oneShotRelayerUrl = process.env.ONE_SHOT_RELAYER_URL
  ?? process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
  ?? "https://relayer.1shotapi.dev/relayers";
const allowedPolicies = csvSet(process.env.ALLOWED_GENLAYER_POLICY_ADDRESSES ?? process.env.NEXT_PUBLIC_GENLAYER_POLICY);
const allowedChainIds = csvSet(process.env.ALLOWED_EVM_CHAIN_IDS ?? "84532,421614");

interface SubmitBody {
  chainId: number;
  policy: Address;
  delegatedAccount: Address;
  recipient: Address;
  amount: string;
  category: string;
  justification: string;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function privateKey() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("Platform signer is not configured");
  return key.startsWith("0x") ? key as Hex : `0x${key}` as Hex;
}

function parseSubmitBody(value: unknown): SubmitBody {
  if (!value || typeof value !== "object") throw new Error("Invalid request payload");
  const body = value as Record<string, unknown>;
  const chainId = Number(body.chainId);
  const policy = body.policy;
  const delegatedAccount = body.delegatedAccount;
  const recipient = body.recipient;
  const amount = body.amount;
  const category = body.category;
  const justification = body.justification;

  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id");
  if (!allowedChainIds.has(String(chainId))) throw new Error("chain not allowed");
  if (typeof policy !== "string" || !isAddress(policy)) throw new Error("Invalid policy address");
  if (!allowedPolicies.has(policy.toLowerCase())) throw new Error("policy not allowed");
  if (typeof delegatedAccount !== "string" || !isAddress(delegatedAccount)) throw new Error("Invalid delegated account");
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new Error("Invalid recipient");
  if (typeof amount !== "string" || Number(amount) <= 0) throw new Error("Invalid amount");
  if (typeof category !== "string" || category.trim() === "") throw new Error("Invalid category");
  if (typeof justification !== "string" || justification.trim().length < 4) throw new Error("Add a clearer justification");

  return {
    chainId,
    policy: policy as Address,
    delegatedAccount: delegatedAccount as Address,
    recipient: recipient as Address,
    amount,
    category: category.trim(),
    justification: justification.trim(),
  };
}

async function genlayerRpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!rpcUrl) throw new Error("GenLayer RPC is not configured");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  const data = await response.json().catch(() => {
    throw new Error("GenLayer returned an unreadable response");
  }) as { error?: { message?: string }, result?: T };
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result as T;
}

async function executeHostedRelayer(relayPayload: Record<string, unknown>) {
  const response = await fetch(oneShotRelayerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(relayPayload),
  });
  const data = await response.json().catch(async () => ({ raw: await response.text() })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`1Shot relayer failed: ${response.status} ${JSON.stringify(data).slice(0, 240)}`);
  }

  const txHash = String(data.tx_hash ?? data.txHash ?? data.hash ?? "");
  if (!isHex(txHash, { strict: true })) {
    throw new Error(`1Shot relayer response missing tx hash: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return txHash;
}

export async function POST(request: Request) {
  try {
    const body = parseSubmitBody(await request.json());
    const account = privateKeyToAccount(privateKey());
    const amountAtto = parseUnits(body.amount, 6);
    const requestId = keccak256(stringToHex(`${body.policy}:${body.delegatedAccount}:${body.recipient}:${body.amount}:${body.category}:${body.justification}`));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
    const justificationHash = keccak256(stringToHex(body.justification));
    const message = {
      policy: body.policy,
      delegatedAccount: body.delegatedAccount,
      recipient: body.recipient,
      amountAtto,
      category: body.category,
      justificationHash,
      requestId,
      deadline,
    } satisfies TreasuryRequestMessage;

    const signature = await account.signTypedData({
      domain: buildTreasuryRequestDomain(body.chainId, body.policy),
      types: treasuryRequestTypes,
      primaryType: "TreasuryRequest",
      message,
    });

    const genlayer = await genlayerRpc<Record<string, unknown>>("gen_write", [{
      to: body.policy,
      method: "submit_request",
      args: [
        body.recipient,
        amountAtto.toString(),
        body.category,
        body.justification,
        justificationHash,
        signature,
        requestId,
        deadline.toString(),
      ],
    }]);

    if (genlayer.verdict !== "approved") {
      return Response.json({ request_id: requestId, signer: account.address, genlayer });
    }

    const relay = genlayer.relay;
    if (!relay || typeof relay !== "object") throw new Error("Approved request did not include a relay payload");
    const txHash = await executeHostedRelayer(relay as Record<string, unknown>);
    const record = await genlayerRpc<Record<string, unknown>>("gen_write", [{
      to: body.policy,
      method: "record_execution",
      args: [requestId, txHash],
    }]);

    return Response.json({
      request_id: requestId,
      signer: account.address,
      genlayer,
      relay: {
        tx_hash: txHash,
        genlayer_record_execution: {
          method: "record_execution",
          args: [requestId, txHash],
        },
      },
      record,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
  }
}
