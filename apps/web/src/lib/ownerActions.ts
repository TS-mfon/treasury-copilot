import {
  buildOwnerActionDomain,
  ownerActionTypes,
} from "@treasury-copilot/shared";
import {
  keccak256,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";

export interface OwnerActionMessage {
  owner: Address;
  action: string;
  policy: Address;
  agent: Address;
  chainId: bigint;
  token: Address;
  payloadHash: Hex;
  nonce: bigint;
  deadline: bigint;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function hashActionPayload(values: readonly unknown[]): Hex {
  return keccak256(stringToHex(canonicalJson(values)));
}

export function hashSetupActionPayload(params: {
  agent: Address;
  delegatedAccount: Address;
  chainId: number;
  token: Address;
  tokenSymbol: string;
  permissionContext: Hex;
  serializedDelegation: string;
  perTxCapUnits: string;
  weeklyCapUnits: string;
  policyText: string;
  whitelist: string;
}) {
  return hashActionPayload([
    params.agent.toLowerCase(),
    params.delegatedAccount.toLowerCase(),
    params.chainId,
    params.token.toLowerCase(),
    params.tokenSymbol,
    params.permissionContext,
    params.serializedDelegation,
    params.perTxCapUnits,
    params.weeklyCapUnits,
    params.policyText,
    params.whitelist,
  ]);
}

export function hashPolicyUpdateActionPayload(params: {
  perTxCapUnits: string;
  weeklyCapUnits: string;
  policyText: string;
}) {
  return hashActionPayload([
    params.perTxCapUnits,
    params.weeklyCapUnits,
    params.policyText,
  ]);
}

export async function verifyOwnerAction(params: {
  registry: Address;
  chainId: number;
  message: OwnerActionMessage;
  signature: Hex;
}) {
  if (params.message.deadline < BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("Owner authorization expired");
  }
  const valid = await verifyTypedData({
    address: params.message.owner,
    domain: buildOwnerActionDomain(params.chainId, params.registry),
    types: ownerActionTypes,
    primaryType: "OwnerAction",
    message: params.message,
    signature: params.signature,
  });
  if (!valid) throw new Error("Owner authorization signature is invalid");
}
