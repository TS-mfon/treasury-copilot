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
  // Circle's published domain ids. Only forwarding-capable domains belong here, which is why 37
  // (X Layer) is absent even though CCTP supports it.
  assert.deepEqual(
    { ...CCTP_DOMAIN },
    {
      ethereum: 0, avalanche: 1, optimism: 2, arbitrum: 3, base: 6, polygon: 7,
      unichain: 10, linea: 11, codex: 12, sonic: 13, worldchain: 14, monad: 15,
      sei: 16, xdc: 18, hyperEvm: 19, ink: 21, plume: 22, arc: 26,
    },
  );
});

test("no two registry chains claim the same CCTP domain in the same environment", () => {
  // A domain identifies a chain within one Circle environment. Two registry entries sharing both
  // would make a route ambiguous, and the one picked would be arbitrary.
  const seen = new Map<string, string>();
  for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
    if (!chain.cctp) continue;
    const slot = `${chain.cctp.attestationApiUrl}#${chain.cctp.domain}`;
    const previous = seen.get(slot);
    assert.equal(previous, undefined, `${key} and ${previous} share domain ${chain.cctp.domain}`);
    seen.set(slot, key);
  }
});

// --- settlement vs destination ------------------------------------------------------------------

// Derived, not hand-written. A hand-kept list silently stops covering chains added later, and
// the point of these two tests is that the registry is exhaustively partitioned.
const DESTINATION_ONLY = (Object.keys(SUPPORTED_CHAINS) as SupportedChainKey[])
  .filter((key) => SUPPORTED_CHAINS[key].destinationOnly);
const SETTLEMENT = (Object.keys(SUPPORTED_CHAINS) as SupportedChainKey[])
  .filter((key) => !SUPPORTED_CHAINS[key].destinationOnly);

test("every chain is either settleable or a payout destination, and never both", () => {
  // The partition is the invariant the rest of the routing relies on: `settlementBackendForChainId`
  // throws for destinations, so a chain in neither bucket would be unroutable and a chain in both
  // would be contradictory.
  assert.equal(
    DESTINATION_ONLY.length + SETTLEMENT.length,
    Object.keys(SUPPORTED_CHAINS).length,
  );
  assert.ok(SETTLEMENT.length > 0 && DESTINATION_ONLY.length > 0);
  assert.equal(SETTLEMENT.filter((key) => DESTINATION_ONLY.includes(key)).length, 0);

  // The five settlement chains are a deliberate, reviewed set, so name them: a new one appearing
  // here without a backend and a funded executor would be a policy that cannot execute.
  assert.deepEqual(
    [...SETTLEMENT].sort(),
    ["arbitrumSepolia", "arc", "arcTestnet", "base", "baseSepolia"],
  );
});

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

test("every CCTP destination in the registry is one Circle will forward to", () => {
  // Our vault calls depositForBurnWithHook with the forwarding hook, so Circle performs the
  // destination mint. A chain that CCTP supports but forwarding does not would burn on Arc and
  // never credit the payee, because we hold no executor key or gas on the destination.
  //
  // This list is the Forwarding Service column of Circle's supported-domains table, confirmed
  // against the live fee API by scripts/verify-cctp-candidates.mts. Domain 37 (X Layer) is
  // deliberately absent: CCTP supports it, forwarding does not.
  const forwardable = new Set([0, 1, 2, 3, 6, 7, 10, 11, 12, 13, 14, 15, 16, 18, 19, 21, 22, 26]);
  for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
    if (!chain.cctp) continue;
    assert.ok(
      forwardable.has(chain.cctp.domain),
      `${key} has CCTP domain ${chain.cctp.domain}, which Circle will not forward to`,
    );
  }
});

test("X Layer is absent from the registry entirely", () => {
  // It was removed rather than disabled. A disabled-but-present chain invites someone to switch
  // it back on without rechecking whether forwarding exists.
  const keys = Object.keys(SUPPORTED_CHAINS);
  assert.ok(!keys.some((key) => key.toLowerCase().includes("xlayer")), `found ${keys}`);
  assert.equal(chainById(196), undefined);
  assert.equal(chainById(1952), undefined);
});
