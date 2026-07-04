import type { Address, Hex } from "viem";
import type { TreasuryRequestMessage } from "@treasury-copilot/shared";

export async function signWithPlatformAgent(params: {
  chainId: number;
  policy: Address;
  message: TreasuryRequestMessage;
}) {
  const response = await fetch("/api/sign-agent-request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: params.chainId,
      policy: params.policy,
      message: {
        ...params.message,
        amountAtto: params.message.amountAtto.toString(),
        deadline: params.message.deadline.toString(),
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not sign request");
  return data as { signer: Address; signature: Hex };
}
