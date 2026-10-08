import assert from "node:assert/strict";
import test from "node:test";
import { CCTP_DOMAIN, SUPPORTED_CHAINS, chainById, type SupportedChainKey } from "@treasury-copilot/shared";
import {
  canReceiveCctp,
  canSettleOnChain,
  cctpDomainFor,
  settlementBackendForChainId,
} from "../src/lib/executionBackend";

/**
 * Circle's published CCTP V2 domains and USDC addresses, transcribed from
 * developers.circle.com. These are measured against the registry rather than read from it, so a
 * typo in the registry fails here instead of silently misrouting a payment.
 */
const EXPECTED: Array<{ key: SupportedChainKey; chainId: number; domain: number; usdc: string }> = [
  { key: "ethereum", chainId: 1, domain: 0, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { key: "ethereumSepolia", chainId: 11155111, domain: 0, usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  { key: "optimism", chainId: 10, domain: 2, usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { key: "optimismSepolia", chainId: 11155420, domain: 2, usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" },
  { key: "arbitrum", chainId: 42161, domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { key: "arbitrumSepolia", chainId: 421614, domain: 3, usdc: "" },
  { key: "base", chainId: 8453, domain: 6, usdc: "" },
  { key: "baseSepolia", chainId: 84532, domain: 6, usdc: "" },
  { key: "polygon", chainId: 137, domain: 7, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  { key: "polygonAmoy", chainId: 80002, domain: 7, usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" },
  { key: "arc", chainId: 5042, domain: 26, usdc: "0x3600000000000000000000000000000000000000" },
  { key: "arcTestnet", chainId: 5042002, domain: 26, usdc: "0x3600000000000000000000000000000000000000" },
];

test("every supported chain carries Circle's published CCTP domain", () => {
  for (const expected of EXPECTED) {
    const chain = SUPPORTED_CHAINS[expected.key];
    assert.ok(chain, `${expected.key} is missing from the registry`);
    assert.equal(chain.chainId, expected.chainId, `${expected.key} chain id`);
    assert.equal(chain.cctp?.domain, expected.domain, `${expected.key} CCTP domain`);
    assert.equal(cctpDomainFor(expected.chainId), expected.domain, `${expected.key} domain lookup`);
    assert.ok(canReceiveCctp(expected.chainId), `${expected.key} should accept CCTP`);
  }
});

test("USDC addresses match Circle's published contracts where they are not env-configured", () => {
  for (const expected of EXPECTED.filter((item) => item.usdc !== "")) {
    const configured = SUPPORTED_CHAINS[expected.key].tokens.USDC?.address;
    assert.equal(
      configured?.toLowerCase(),
      expected.usdc.toLowerCase(),
      `${expected.key} USDC address`,
    );
    assert.equal(SUPPORTED_CHAINS[expected.key].tokens.USDC?.decimals, 6, `${expected.key} USDC decimals`);
  }
});

test("a testnet shares its mainnet CCTP domain, which is why the environment must also match", () => {
  assert.equal(SUPPORTED_CHAINS.ethereum.cctp?.domain, SUPPORTED_CHAINS.ethereumSepolia.cctp?.domain);
  assert.equal(SUPPORTED_CHAINS.base.cctp?.domain, SUPPORTED_CHAINS.baseSepolia.cctp?.domain);
  assert.equal(SUPPORTED_CHAINS.arc.cctp?.domain, SUPPORTED_CHAINS.arcTestnet.cctp?.domain);
  // Only the attestation host distinguishes them, so it must differ.
  assert.notEqual(
    SUPPORTED_CHAINS.ethereum.cctp?.attestationApiUrl,
    SUPPORTED_CHAINS.ethereumSepolia.cctp?.attestationApiUrl,
  );
});

test("CCTP_DOMAIN exposes the domains the project routes through", () => {
  assert.deepEqual(
    { ...CCTP_DOMAIN },
    { ethereum: 0, optimism: 2, arbitrum: 3, base: 6, polygon: 7, arc: 26, xLayer: 37 },
  );
});

// --- settlement vs destination ------------------------------------------------------------------

const DESTINATION_ONLY: SupportedChainKey[] = [
  "ethereum", "ethereumSepolia", "optimism", "optimismSepolia", "arbitrum", "polygon", "polygonAmoy",
];
const SETTLEMENT: SupportedChainKey[] = ["baseSepolia", "base", "arbitrumSepolia", "arcTestnet", "arc"];

test("a destination-only chain can receive CCTP but can never hold a treasury", () => {
  for (const key of DESTINATION_ONLY) {
    const chain = SUPPORTED_CHAINS[key];
    assert.equal(chain.destinationOnly, true, `${key} should be destination only`);
    assert.ok(canReceiveCctp(chain.chainId), `${key} should accept CCTP`);
    assert.equal(canSettleOnChain(chain.chainId), false, `${key} must not be settleable`);
    // Binding a policy to one must fail loudly rather than produce an unexecutable policy.
    assert.throws(
      () => settlementBackendForChainId(chain.chainId),
      /payout destination only/,
      `${key} should refuse settlement`,
    );
  }
});

test("settlement chains remain settleable and keep their backend", () => {
  for (const key of SETTLEMENT) {
    const chain = SUPPORTED_CHAINS[key];
    assert.ok(!chain.destinationOnly, `${key} must not be destination only`);
    assert.ok(canSettleOnChain(chain.chainId), `${key} should be settleable`);
    assert.doesNotThrow(() => settlementBackendForChainId(chain.chainId));
  }
  assert.equal(settlementBackendForChainId(5042002), "arc-vault");
  assert.equal(settlementBackendForChainId(84532), "delegated-7710");
});

test("every registry entry is reachable by chain id and has a unique id", () => {
  const seen = new Map<number, string>();
  for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
    const previous = seen.get(chain.chainId);
    assert.equal(previous, undefined, `chain id ${chain.chainId} is used by both ${previous} and ${key}`);
    seen.set(chain.chainId, key);
    assert.equal(chainById(chain.chainId)?.key, key);
  }
});

test("X Layer carries its CCTP domain now that Circle lists it", () => {
  assert.equal(SUPPORTED_CHAINS.xLayer.cctp?.domain, 37);
  // The X Layer testnet is not in Circle's published testnet list, so it stays closed.
  assert.equal(SUPPORTED_CHAINS.xLayerTestnet.cctp, undefined);
});
