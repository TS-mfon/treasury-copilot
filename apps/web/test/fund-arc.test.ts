import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi, type Address } from "viem";
import { buildArcFundingPlan, FundingUnsupportedError } from "../src/lib/arcFunding";

const ARC_TESTNET = 5042002;
const BASE_SEPOLIA = 84532;
// Ethereum Sepolia is the default fixture because its USDC address is a published constant in the
// registry, whereas Base Sepolia's is supplied by NEXT_PUBLIC_BASE_SEPOLIA_USDC at runtime.
const ETHEREUM_SEPOLIA = 11155111;
const vault: Address = "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2";
const ETHEREUM_SEPOLIA_USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa";

const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const burnAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

const feeFetch = (async () => new Response(
  JSON.stringify([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { high: 54662 } }]),
  { status: 200, headers: { "content-type": "application/json" } },
)) as typeof fetch;

async function plan(overrides: Partial<Parameters<typeof buildArcFundingPlan>[0]> = {}) {
  return buildArcFundingPlan(
    { sourceChainId: ETHEREUM_SEPOLIA, destinationChainId: ARC_TESTNET, vault, amount: 10_000_000n, ...overrides },
    { fetchImpl: feeFetch },
  );
}

test("a supported source chain produces an approval and a burn, in that order", async () => {
  const result = await plan();
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].to.toLowerCase(), ETHEREUM_SEPOLIA_USDC);
  assert.equal(result.transactions[1].to.toLowerCase(), TOKEN_MESSENGER);
  // The approval must come first or the burn reverts for want of an allowance.
  assert.match(result.transactions[0].description, /Approve/);
});

test("the owner burns principal plus the fee so the vault receives the full amount", async () => {
  const result = await plan({ amount: 10_000_000n });
  assert.equal(result.amount, 10_000_000n);
  assert.equal(result.maxFee, 54_662n);
  assert.equal(result.totalAmount, 10_054_662n);

  const approval = decodeFunctionData({ abi: approveAbi, data: result.transactions[0].data });
  // The allowance must cover the whole burn, not just the principal.
  assert.equal(approval.args?.[1], 10_054_662n);
  assert.equal(String(approval.args?.[0]).toLowerCase(), TOKEN_MESSENGER);
});

test("the burn names the vault as mint recipient on the Arc domain", async () => {
  const result = await plan();
  const burn = decodeFunctionData({ abi: burnAbi, data: result.transactions[1].data });
  assert.equal(burn.args?.[0], 10_054_662n);
  // Arc's CCTP domain is 26, which is not its chain id.
  assert.equal(burn.args?.[1], 26);
  assert.equal(burn.args?.[2], `0x000000000000000000000000${vault.slice(2)}`);
  assert.equal(String(burn.args?.[3]).toLowerCase(), ETHEREUM_SEPOLIA_USDC);
  assert.equal(burn.args?.[5], 54_662n);
  assert.equal(result.forwarded, true);
});

test("an unsupported source chain is refused with the stage named", async () => {
  await assert.rejects(
    () => plan({ sourceChainId: 999999 }),
    (error: unknown) => error instanceof FundingUnsupportedError && error.stage === "source",
  );
});

test("a chain the registry does not know is refused rather than producing an unusable plan", async () => {
  await assert.rejects(
    // 1952 is not in the registry at all. Every chain that *is* in the registry now carries CCTP,
    // so an unknown id is the only way to reach this branch — which is the point: a funding plan
    // must never be built for a chain whose CCTP wiring we cannot name.
    () => plan({ sourceChainId: 1952 }),
    (error: unknown) => error instanceof FundingUnsupportedError,
  );
});

test("a destination that is not a vault chain is refused", async () => {
  await assert.rejects(
    // Base Sepolia settles by delegation and has no vault to credit.
    () => plan({ sourceChainId: ETHEREUM_SEPOLIA, destinationChainId: BASE_SEPOLIA }),
    (error: unknown) => error instanceof FundingUnsupportedError && error.stage === "destination",
  );
});

test("a cross-environment pair is refused before any calldata is built", async () => {
  await assert.rejects(
    // Arc mainnet destination with a Sepolia source would never be attested.
    () => plan({ sourceChainId: ETHEREUM_SEPOLIA, destinationChainId: 5042 }),
    (error: unknown) => error instanceof FundingUnsupportedError && error.stage === "environment",
  );
});

test("a bad vault address or non-positive amount is refused", async () => {
  await assert.rejects(
    () => plan({ vault: "not-an-address" as Address }),
    (error: unknown) => error instanceof FundingUnsupportedError && error.stage === "vault",
  );
  await assert.rejects(
    () => plan({ amount: 0n }),
    (error: unknown) => error instanceof FundingUnsupportedError && error.stage === "amount",
  );
});

test("Ethereum Sepolia, OP Sepolia and Polygon Amoy can all fund the Arc vault", async () => {
  const burnTokens = new Set<string>();
  for (const chainId of [ETHEREUM_SEPOLIA, 11155420, 80002]) {
    const result = await plan({ sourceChainId: chainId });
    const burn = decodeFunctionData({ abi: burnAbi, data: result.transactions[1].data });
    // Arc's CCTP domain is the destination regardless of which chain funds it.
    assert.equal(burn.args?.[1], 26, `destination domain from chain ${chainId}`);
    assert.equal(result.sourceChainId, chainId);
    burnTokens.add(String(burn.args?.[3]).toLowerCase());
  }
  // Each source must burn its own USDC contract; a shared address would mean a misconfigured chain.
  assert.equal(burnTokens.size, 3, "each source chain should burn a distinct USDC contract");
});
