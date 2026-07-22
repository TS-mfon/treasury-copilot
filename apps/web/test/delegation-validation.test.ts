import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { assertStoredDelegation, validateDelegationGrant } from "../src/lib/delegationValidation";

const owner: Address = "0x1111111111111111111111111111111111111111";
const platform: Address = "0x2222222222222222222222222222222222222222";
const token: Address = "0x3333333333333333333333333333333333333333";
const context: Hex = "0x1234";
const serializedPayload = "{\"context\":\"0x1234\"}";

function grant(overrides: Record<string, unknown> = {}) {
  return {
    from: owner,
    to: platform,
    chainId: 84532,
    context,
    delegationManager: "0x4444444444444444444444444444444444444444",
    permission: {
      type: "erc20-token-periodic",
      data: {
        tokenAddress: token,
        periodAmount: "100000000",
        periodDuration: 604800,
      },
    },
    ...overrides,
  };
}

test("approved ERC-7715 grant must match owner, delegate, chain, token, and exact amount", () => {
  const result = validateDelegationGrant(grant(), {
    owner,
    platformDelegate: platform,
    chainId: 84532,
    token,
    weeklyAllowanceAtto: 100000000n,
    permissionContext: context,
  });

  assert.equal(result.delegatedAccount, owner);
  assert.equal(result.permissionContext, context);
});

test("delegation validation rejects amount and delegate substitution", () => {
  assert.throws(() => validateDelegationGrant(grant({
    permission: {
      type: "erc20-token-periodic",
      data: {
        tokenAddress: token,
        periodAmount: "100000001",
        periodDuration: 604800,
      },
    },
  }), {
    owner,
    platformDelegate: platform,
    chainId: 84532,
    token,
    weeklyAllowanceAtto: 100000000n,
    permissionContext: context,
  }), /exact weekly allowance/);

  assert.throws(() => validateDelegationGrant(grant({
    to: "0x5555555555555555555555555555555555555555",
  }), {
    owner,
    platformDelegate: platform,
    chainId: 84532,
    token,
    weeklyAllowanceAtto: 100000000n,
    permissionContext: context,
  }), /platform executor/);
});

test("GenLayer readback must exactly match the approved delegation", () => {
  const expected = {
    delegatedAccount: owner,
    token,
    permissionContext: context,
    serializedPayload,
  };
  assert.doesNotThrow(() => assertStoredDelegation({
    delegation_registered: true,
    delegated_account: owner,
    token_address: token,
    delegation_context: context,
    delegation_payload: serializedPayload,
  }, expected));
  assert.throws(() => assertStoredDelegation({
    delegation_registered: true,
    delegated_account: owner,
    token_address: token,
    delegation_context: context,
    delegation_payload: "{}",
  }, expected), /payload/);
});
