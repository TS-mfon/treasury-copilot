import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_CHAINS, CCTP_DOMAIN, chainById } from "@treasury-copilot/shared";
import {
  arcSettlementEnabled,
  assertSettlementAvailable,
  isDelegationSettledChain,
  isVaultSettledChain,
  settlementBackendForChainId,
} from "../src/lib/executionBackend";

const ARC_TESTNET = 5042002;
const ARC_MAINNET = 5042;
const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("existing chains keep the ERC-7715 delegation backend", () => {
  assert.equal(settlementBackendForChainId(BASE_SEPOLIA), "delegated-7710");
  assert.equal(settlementBackendForChainId(ARBITRUM_SEPOLIA), "delegated-7710");
  assert.equal(settlementBackendForChainId(8453), "delegated-7710");
  assert.ok(isDelegationSettledChain(BASE_SEPOLIA));
  assert.ok(!isVaultSettledChain(BASE_SEPOLIA));
});

test("Arc settles through the vault backend and never the delegation path", () => {
  for (const chainId of [ARC_TESTNET, ARC_MAINNET]) {
    assert.equal(settlementBackendForChainId(chainId), "arc-vault");
    assert.ok(isVaultSettledChain(chainId));
    // Arc has no MetaMask Delegation Framework and no 1Shot capability entry, so routing it
    // into the 7710 path would fail inside the relayer rather than at the boundary.
    assert.ok(!isDelegationSettledChain(chainId));
  }
});

test("an unknown chain is rejected rather than defaulting to a backend", () => {
  assert.throws(() => settlementBackendForChainId(999999), /Unsupported chain id/);
});

test("Arc settlement stays gated behind a server-side flag", () => {
  withEnv({ ARC_SETTLEMENT_ENABLED: undefined }, () => {
    assert.equal(arcSettlementEnabled(), false);
    assert.throws(() => assertSettlementAvailable(ARC_TESTNET), /Arc settlement is disabled/);
    // A disabled Arc flag must not affect the existing Base Sepolia pilot.
    assert.doesNotThrow(() => assertSettlementAvailable(BASE_SEPOLIA));
  });
  withEnv({ ARC_SETTLEMENT_ENABLED: "true" }, () => {
    assert.equal(arcSettlementEnabled(), true);
    assert.doesNotThrow(() => assertSettlementAvailable(ARC_TESTNET));
  });
  withEnv({ ARC_SETTLEMENT_ENABLED: "no" }, () => {
    assert.equal(arcSettlementEnabled(), false);
  });
});

test("Arc chain config carries the verified network constants", () => {
  const arc = SUPPORTED_CHAINS.arcTestnet;
  assert.equal(arc.chainId, ARC_TESTNET);
  assert.equal(arc.explorerUrl, "https://explorer.testnet.arc.io");
  // Gas is native USDC at 18 decimals while the ERC-20 interface the vault uses reports 6.
  // Conflating them overstates a balance by 1e12.
  assert.equal(arc.nativeSymbol, "USDC");
  assert.equal(arc.nativeDecimals, 18);
  assert.equal(arc.tokens.USDC?.decimals, 6);
  assert.equal(arc.minMaxFeePerGas, 20_000_000_000n);
  assert.equal(arc.maxLogRange, 9_999);
  assert.equal(chainById(ARC_TESTNET)?.key, "arcTestnet");
});

test("CCTP domains are distinct per chain and shared contracts match across chains", () => {
  assert.equal(CCTP_DOMAIN.arc, 26);
  assert.equal(CCTP_DOMAIN.base, 6);
  assert.equal(SUPPORTED_CHAINS.arcTestnet.cctp?.domain, 26);
  assert.equal(SUPPORTED_CHAINS.baseSepolia.cctp?.domain, 6);
  assert.equal(SUPPORTED_CHAINS.arbitrumSepolia.cctp?.domain, 3);

  // CCTP V2 is deployed at the same address on every supported chain, so a testnet Arc burn and
  // a Base Sepolia mint must reference identical contracts.
  assert.equal(
    SUPPORTED_CHAINS.arcTestnet.cctp?.tokenMessenger,
    SUPPORTED_CHAINS.baseSepolia.cctp?.tokenMessenger,
  );
  assert.equal(
    SUPPORTED_CHAINS.arcTestnet.cctp?.messageTransmitter,
    SUPPORTED_CHAINS.baseSepolia.cctp?.messageTransmitter,
  );
  assert.equal(SUPPORTED_CHAINS.arcTestnet.cctp?.attestationApiUrl, "https://iris-api-sandbox.circle.com");
  assert.equal(SUPPORTED_CHAINS.arc.cctp?.attestationApiUrl, "https://iris-api.circle.com");
  // Mainnet and testnet CCTP deployments are different addresses.
  assert.notEqual(
    SUPPORTED_CHAINS.arc.cctp?.tokenMessenger,
    SUPPORTED_CHAINS.arcTestnet.cctp?.tokenMessenger,
  );
});

test("X Layer has no CCTP config so cross-chain routes stay closed", () => {
  assert.equal(SUPPORTED_CHAINS.xLayer.cctp, undefined);
  assert.equal(SUPPORTED_CHAINS.xLayerTestnet.cctp, undefined);
});

test("the Arc executor key is validated and must differ from the platform signer", async () => {
  const { arcExecutorAccount } = await import("../src/lib/arcVault");
  const keyA = `0x${"11".repeat(32)}`;
  const keyB = `0x${"22".repeat(32)}`;

  withEnv({ ARC_EXECUTOR_PRIVATE_KEY: undefined }, () => {
    assert.throws(() => arcExecutorAccount(), /Arc executor is not configured/);
  });
  withEnv({ ARC_EXECUTOR_PRIVATE_KEY: "0xdeadbeef" }, () => {
    assert.throws(() => arcExecutorAccount(), /exactly 32 bytes of hex/);
  });
  // Signer separation: the Arc executor must not also be the GenLayer reporter / platform signer.
  withEnv({ ARC_EXECUTOR_PRIVATE_KEY: keyA, AGENT_SIGNER_PRIVATE_KEY: keyA }, () => {
    assert.throws(() => arcExecutorAccount(), /must differ from the platform signer/);
  });
  withEnv({ ARC_EXECUTOR_PRIVATE_KEY: keyA, AGENT_SIGNER_PRIVATE_KEY: keyB }, () => {
    assert.doesNotThrow(() => arcExecutorAccount());
  });
});
