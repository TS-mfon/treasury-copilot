import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTreasuryRequestDomain, treasuryRequestTypes, type TreasuryRequestMessage } from "@treasury-copilot/shared";

export const runtime = "nodejs";

function privateKey() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("Platform signer is not configured");
  return key.startsWith("0x") ? key as Hex : `0x${key}` as Hex;
}

function parseBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid signing request");
  const value = body as Record<string, unknown>;
  const chainId = Number(value.chainId);
  const policy = value.policy;
  const message = value.message as Record<string, unknown> | undefined;

  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id");
  if (typeof policy !== "string" || !isAddress(policy)) throw new Error("Invalid policy address");
  if (!message || typeof message !== "object") throw new Error("Invalid request payload");
  if (message.policy !== policy) throw new Error("Policy mismatch");
  if (typeof message.delegatedAccount !== "string" || !isAddress(message.delegatedAccount)) throw new Error("Invalid delegated account");
  if (typeof message.recipient !== "string" || !isAddress(message.recipient)) throw new Error("Invalid recipient");
  if (typeof message.amountAtto !== "string" || !/^[1-9][0-9]*$/.test(message.amountAtto)) throw new Error("Invalid amount");
  if (typeof message.category !== "string" || message.category.trim() === "") throw new Error("Invalid category");
  if (typeof message.justificationHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(message.justificationHash)) throw new Error("Invalid justification hash");
  if (typeof message.requestId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(message.requestId)) throw new Error("Invalid request id");
  if (typeof message.deadline !== "string" || !/^[1-9][0-9]*$/.test(message.deadline)) throw new Error("Invalid deadline");

  return {
    chainId,
    policy: policy as Address,
    message: {
      policy: policy as Address,
      delegatedAccount: message.delegatedAccount as Address,
      recipient: message.recipient as Address,
      amountAtto: BigInt(message.amountAtto),
      category: message.category,
      justificationHash: message.justificationHash as Hex,
      requestId: message.requestId as Hex,
      deadline: BigInt(message.deadline),
    } satisfies TreasuryRequestMessage,
  };
}

export async function POST(request: Request) {
  try {
    const parsed = parseBody(await request.json());
    const account = privateKeyToAccount(privateKey());
    const signature = await account.signTypedData({
      domain: buildTreasuryRequestDomain(parsed.chainId, parsed.policy),
      types: treasuryRequestTypes,
      primaryType: "TreasuryRequest",
      message: parsed.message,
    });
    return Response.json({ signer: account.address, signature });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Signing failed" }, { status: 400 });
  }
}
