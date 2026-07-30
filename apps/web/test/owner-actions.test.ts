import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  hashActionPayload,
  hashPolicyUpdateActionPayload,
  hashSetupActionPayload,
} from "../src/lib/ownerActions";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;

test("canonical JSON is stable across object property order", () => {
  const left = { z: 3, nested: { b: 2n, a: 1 }, list: [{ y: true, x: false }] };
  const right = { list: [{ x: false, y: true }], nested: { a: 1, b: "2" }, z: 3 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(hashActionPayload([left]), hashActionPayload([right]));
});

test("canonical JSON distinguishes changed delegation values", () => {
  assert.notEqual(hashActionPayload([{ amount: "100" }]), hashActionPayload([{ amount: "101" }]));
});

test("setup authorization schema binds funding and policy inputs without a fast-approval field", () => {
  const params = {
    agent: address("1"),
    delegatedAccount: address("2"),
    chainId: 84532,
    token: address("3"),
    tokenSymbol: "USDC",
    permissionContext: "0x1234" as const,
    serializedDelegation: "{\"context\":\"0x1234\"}",
    perTxCapUnits: "25000000",
    weeklyCapUnits: "100000000",
    policyText: "Pay only approved hosting subscriptions",
    whitelist: address("4"),
  };
  assert.equal(
    hashSetupActionPayload(params),
    hashActionPayload([
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
    ]),
  );
});

test("policy update authorization schema has no configurable fast-approval value", () => {
  const params = {
    perTxCapUnits: "25000000",
    weeklyCapUnits: "100000000",
    policyText: "Pay only approved hosting subscriptions",
  };
  assert.equal(
    hashPolicyUpdateActionPayload(params),
    hashActionPayload([
      params.perTxCapUnits,
      params.weeklyCapUnits,
      params.policyText,
    ]),
  );
});
