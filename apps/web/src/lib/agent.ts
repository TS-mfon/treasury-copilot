import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildTreasuryRequestDomain, treasuryRequestTypes, type TreasuryRequestMessage } from "@treasury-copilot/shared";

export function generateAgentKey() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

export function justificationHash(justification: string): Hex {
  return keccak256(stringToHex(justification));
}

export async function signTreasuryRequest(privateKey: Hex, chainId: number, policy: Address, message: TreasuryRequestMessage) {
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: buildTreasuryRequestDomain(chainId, policy),
    types: treasuryRequestTypes,
    primaryType: "TreasuryRequest",
    message,
  });
  return { signer: account.address, signature };
}

