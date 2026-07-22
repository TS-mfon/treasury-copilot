import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount, parseAmount } from "../src/lib/amounts";

test("USDC decimal strings convert to exact six-decimal units", () => {
  assert.equal(parseAmount("100", 6), 100_000_000n);
  assert.equal(parseAmount("0.000001", 6), 1n);
  assert.equal(parseAmount("25.42", 6), 25_420_000n);
});

test("amount parser rejects unsafe or imprecise forms", () => {
  assert.throws(() => parseAmount("0.0000001", 6), /too many decimal places/);
  assert.throws(() => parseAmount("1e3", 6), /positive decimal string/);
  assert.throws(() => parseAmount("-1", 6), /positive decimal string/);
  assert.throws(() => parseAmount("0", 6), /greater than zero/);
});

test("formatting preserves raw units and configured decimals", () => {
  assert.deepEqual(formatAmount("100000001", 6), {
    display: "100.000001",
    units: "100000001",
    decimals: 6,
  });
});
