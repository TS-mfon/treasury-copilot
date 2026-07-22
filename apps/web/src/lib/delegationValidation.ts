import { isAddress, isHex, type Address, type Hex } from "viem";

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

type DelegationExpectation = {
  owner: Address;
  platformDelegate: Address;
  chainId: number;
  token: Address;
  weeklyAllowanceAtto: bigint;
  permissionContext: Hex;
};

type StoredDelegationExpectation = {
  delegatedAccount: Address;
  token: Address;
  permissionContext: Hex;
  serializedPayload: string;
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function addressValue(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`Delegation ${label} is invalid`);
  }
  return value as Address;
}

function integerValue(value: unknown, label: string): bigint {
  if (
    typeof value !== "bigint"
    && typeof value !== "number"
    && typeof value !== "string"
  ) {
    throw new Error(`Delegation ${label} is invalid`);
  }

  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`Delegation ${label} is invalid`);
  }
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function validateDelegationGrant(
  payload: unknown,
  expected: DelegationExpectation,
) {
  const grant = objectValue(payload, "payload");
  const permission = objectValue(grant.permission, "permission");
  const data = objectValue(permission.data, "permission data");
  const context = grant.context;
  const delegationManager = grant.delegationManager;

  if (typeof context !== "string" || !isHex(context, { strict: true })) {
    throw new Error("Delegation permission context is invalid");
  }
  if (context.toLowerCase() !== expected.permissionContext.toLowerCase()) {
    throw new Error("Delegation permission context does not match the approved grant");
  }
  addressValue(delegationManager, "manager");

  const from = addressValue(grant.from, "owner account");
  if (!sameAddress(from, expected.owner)) {
    throw new Error("Delegation owner account does not match the authenticated owner");
  }
  const to = addressValue(grant.to, "delegate");
  if (!sameAddress(to, expected.platformDelegate)) {
    throw new Error("Delegation delegate does not match the platform executor");
  }
  if (Number(integerValue(grant.chainId, "chain id")) !== expected.chainId) {
    throw new Error("Delegation chain does not match setup");
  }
  if (permission.type !== "erc20-token-periodic") {
    throw new Error("Delegation permission type must be erc20-token-periodic");
  }

  const token = addressValue(data.tokenAddress, "token");
  if (!sameAddress(token, expected.token)) {
    throw new Error("Delegation token does not match setup");
  }
  if (integerValue(data.periodAmount, "period amount") !== expected.weeklyAllowanceAtto) {
    throw new Error("Delegation amount does not match the exact weekly allowance");
  }
  if (integerValue(data.periodDuration, "period duration") !== BigInt(WEEK_IN_SECONDS)) {
    throw new Error("Delegation period must be exactly one week");
  }

  return {
    delegatedAccount: from,
    delegationManager: delegationManager as Address,
    permissionContext: context as Hex,
  };
}

export function assertStoredDelegation(
  state: Record<string, unknown>,
  expected: StoredDelegationExpectation,
) {
  if (state.delegation_registered !== true) {
    throw new Error("GenLayer did not finalize the delegation registration");
  }
  if (
    typeof state.delegated_account !== "string"
    || !sameAddress(state.delegated_account, expected.delegatedAccount)
  ) {
    throw new Error("Stored delegated account does not match the approved grant");
  }
  if (
    typeof state.token_address !== "string"
    || !sameAddress(state.token_address, expected.token)
  ) {
    throw new Error("Stored delegation token does not match the approved grant");
  }
  if (
    typeof state.delegation_context !== "string"
    || state.delegation_context.toLowerCase() !== expected.permissionContext.toLowerCase()
  ) {
    throw new Error("Stored permission context does not match the approved grant");
  }
  if (state.delegation_payload !== expected.serializedPayload) {
    throw new Error("Stored delegation payload does not match the approved grant");
  }
}
