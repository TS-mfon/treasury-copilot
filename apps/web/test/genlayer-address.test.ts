import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGenLayerAddress } from "../src/lib/genlayerAddress";

test("GenLayer contract addresses are restored to EIP-55 casing", () => {
  assert.equal(
    canonicalGenLayerAddress("0x809f30d513b0f6c366b1854043ebc13fe9955097"),
    "0x809F30D513B0F6C366B1854043EBC13FE9955097",
  );
  assert.equal(
    canonicalGenLayerAddress("0x252df8515ee24e1844ffc53da65f1afc83d02b70"),
    "0x252Df8515eE24e1844fFC53DA65f1AfC83d02b70",
  );
});

test("invalid GenLayer contract addresses are rejected", () => {
  assert.throws(() => canonicalGenLayerAddress("0x1234"), /Invalid GenLayer contract address/);
});
