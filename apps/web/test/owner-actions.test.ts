import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, hashActionPayload } from "../src/lib/ownerActions";

test("canonical JSON is stable across object property order", () => {
  const left = { z: 3, nested: { b: 2n, a: 1 }, list: [{ y: true, x: false }] };
  const right = { list: [{ x: false, y: true }], nested: { a: 1, b: "2" }, z: 3 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(hashActionPayload([left]), hashActionPayload([right]));
});

test("canonical JSON distinguishes changed delegation values", () => {
  assert.notEqual(hashActionPayload([{ amount: "100" }]), hashActionPayload([{ amount: "101" }]));
});
