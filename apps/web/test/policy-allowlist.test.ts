import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { assertPolicyAllowed } from "../src/lib/apiServer";
import { csvSet } from "../src/lib/env";

const ALLOWED: Address = "0xbF9aa94fd73a883be48b381b41eb7619181bd9fa";
const OTHER: Address = "0x704345601942b0e7ec503bffd6faca5f40d746e9";
const DENIED: Address = "0x9999999999999999999999999999999999999999";

/**
 * The allowlist is parsed by the same `csvSet` the server env uses, so these cases exercise the
 * real parsing rules rather than a reimplementation of them.
 */
function listOf(raw: string) {
  const previous = process.env.__TEST_ALLOWLIST;
  process.env.__TEST_ALLOWLIST = raw;
  try {
    return csvSet("__TEST_ALLOWLIST");
  } finally {
    if (previous === undefined) delete process.env.__TEST_ALLOWLIST;
    else process.env.__TEST_ALLOWLIST = previous;
  }
}

test("an empty allowlist means unrestricted, so existing deployments keep working", () => {
  const empty = listOf("");
  assert.equal(empty.size, 0);
  assert.doesNotThrow(() => assertPolicyAllowed(ALLOWED, empty));
  assert.doesNotThrow(() => assertPolicyAllowed(DENIED, empty));
});

test("a non-empty allowlist actually rejects a policy outside it", () => {
  // The control that proves enforcement rather than mere parsing: DENIED passes under the empty
  // list above and must fail here.
  const list = listOf(`${ALLOWED},${OTHER}`);
  assert.equal(list.size, 2);
  assert.doesNotThrow(() => assertPolicyAllowed(ALLOWED, list));
  assert.doesNotThrow(() => assertPolicyAllowed(OTHER, list));
  assert.throws(() => assertPolicyAllowed(DENIED, list), /not allowed on this deployment/);
});

test("allowlist matching ignores address casing on both sides", () => {
  const upper = ALLOWED.toUpperCase().replace("0X", "0x") as Address;
  const list = listOf(upper);
  assert.doesNotThrow(() => assertPolicyAllowed(ALLOWED, list));
  assert.doesNotThrow(() => assertPolicyAllowed(upper, list));
  assert.throws(() => assertPolicyAllowed(DENIED, list));
});

test("whitespace and empty entries are ignored without widening the list", () => {
  const list = listOf(` ${ALLOWED} , , ${OTHER} `);
  assert.equal(list.size, 2, "blank entries must not become allowlist members");
  assert.doesNotThrow(() => assertPolicyAllowed(ALLOWED, list));
  assert.doesNotThrow(() => assertPolicyAllowed(OTHER, list));
  assert.throws(() => assertPolicyAllowed(DENIED, list));
});

test("a single-entry allowlist does not accidentally permit a prefix or substring", () => {
  const list = listOf(ALLOWED);
  const prefix = ALLOWED.slice(0, 20) as Address;
  assert.throws(() => assertPolicyAllowed(prefix, list));
  assert.throws(() => assertPolicyAllowed(`${ALLOWED}00` as Address, list));
});
