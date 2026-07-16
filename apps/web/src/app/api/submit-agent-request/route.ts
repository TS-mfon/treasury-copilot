import { isAddress, isHex, keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTreasuryRequestDomain, treasuryRequestTypes, type TreasuryRequestMessage } from "@treasury-copilot/shared";
import { executeOneShot, type OneShotRelayRequest } from "@/lib/oneShot7710";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  try {
    const body = parseSubmitBody(await request.json());
    const account = privateKeyToAccount(privateKey());
    const amountAtto = parseUnits(body.amount, 6);
    const requestId = keccak256(stringToHex(`${body.policy}:${body.delegatedAccount}:${body.recipient}:${amountAtto}:${body.category}:${body.justification}:${Date.now().toString()}`));
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

    const submit = await genlayerWrite(body.policy, "submit_request", [
      body.recipient,
      amountAtto.toString(),
      body.category,
      body.justification,
      justificationHash,
      signature,
      requestId,
      deadline.toString(),
    ]);
    const genlayer = await genlayerRead<Record<string, unknown>>(body.policy, "get_request", [requestId]);

    if (genlayer.verdict !== "approved") {
      return Response.json({ request_id: requestId, signer: account.address, genlayer, submit });
    }

    const policyState = await genlayerRead<Record<string, unknown>>(body.policy, "get_policy");
    const relay = {
      policy: body.policy,
      chain_id: String(policyState.evm_chain_id ?? body.chainId),
      delegated_account: String(policyState.delegated_account ?? body.delegatedAccount),
      token: String(policyState.token_address ?? ""),
      delegation: "metamask-smart-account-payout",
      permission_context: String(policyState.delegation_context ?? ""),
      delegation_payload: policyState.delegation_payload,
      params: {
        requestId,
        from: String(policyState.delegated_account ?? body.delegatedAccount),
        token: String(policyState.token_address ?? ""),
        recipient: body.recipient,
        amount: amountAtto.toString(),
      },
    };
    const execution = await executeOneShot(relay as OneShotRelayRequest);
    const txHash = execution.tx_hash;
    const record = await genlayerWrite(body.policy, "record_execution", [requestId, txHash]);

    return Response.json({
      request_id: requestId,
      signer: account.address,
      genlayer,
      submit,
      relay: {
        tx_hash: txHash,
        genlayer_record_execution: {
          method: "record_execution",
          args: [requestId, txHash],
        },
      },
      one_shot: execution,
      record,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
  }
}
