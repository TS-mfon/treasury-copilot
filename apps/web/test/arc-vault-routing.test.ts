import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { planVaultPayout, type ArcVaultPayoutRequest } from "../src/lib/arcVault";
import { FORWARDING_HOOK_DATA, quoteFee, resolveRoute } from "../src/lib/cctp";

const ARC_TESTNET = 5042002;
const BASE_SEPOLIA = 84532;
const vault: Address = "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2";
const recipient: Address = "0xed9edd8586b20524cafa4f568413c504c9b03172";
const requestId: Hex = `0x${"ab".repeat(32)}`;

function request(overrides: Partial<ArcVaultPayoutRequest> = {}): ArcVaultPayoutRequest {
  return {
    chainId: ARC_TESTNET,
    vault,
    requestId,
    recipient,
    amount: "1000000",
    ...overrides,
  };
}

async function forwardedQuote() {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const quote = await quoteFee(route, {
    forwarded: true,
    fetchImpl: async () => new Response(
      JSON.stringify([{ finalityThreshold: 1000, minimumFee: 0, forwardFee: { high: 54662 } }]),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  return { route, quote };
}

test("a same-chain request settles with payout and never touches CCTP", () => {
  const plan = planVaultPayout(request());
  assert.equal(plan.functionName, "payout");
  assert.equal(plan.route, "direct");
  assert.deepEqual(plan.args, [requestId, recipient, 1_000_000n]);
});

test("an explicit destination equal to the settlement chain is still a direct payout", () => {
  const plan = planVaultPayout(request({ destinationChainId: ARC_TESTNET }));
  assert.equal(plan.functionName, "payout");
  assert.equal(plan.route, "direct");
});

test("a cross-chain request burns principal plus the quoted fee through payoutCrossChain", async () => {
  const { route, quote } = await forwardedQuote();
  const plan = planVaultPayout(request({ destinationChainId: BASE_SEPOLIA }), route, quote);

  assert.equal(plan.functionName, "payoutCrossChain");
  assert.equal(plan.route, "cctp");
  // The contract adds maxFee to the principal, so the payee receives the full approved amount.
  assert.deepEqual(plan.args, [
    requestId,
    recipient,
    1_000_000n,
    6,
    54_662n,
    1000,
    FORWARDING_HOOK_DATA,
  ]);
});

test("the destination domain comes from the route, not the chain id", async () => {
  const { route, quote } = await forwardedQuote();
  const plan = planVaultPayout(request({ destinationChainId: BASE_SEPOLIA }), route, quote);
  // Base Sepolia's chain id is 84532 but its CCTP domain is 6; confusing them would misroute.
  assert.equal(plan.args[3], 6);
  assert.notEqual(plan.args[3], BASE_SEPOLIA);
});

test("a direct-mint quote omits the forwarding hook data", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const plan = planVaultPayout(
    request({ destinationChainId: BASE_SEPOLIA }),
    route,
    { maxFee: 0n, minFinalityThreshold: 2000, protocolFee: 0n, forwardFee: 0n, forwarded: false },
  );
  assert.equal(plan.args[6], "0x");
});

test("a cross-chain request without a quote is refused rather than silently paid on-chain", async () => {
  // The dangerous failure would be falling back to `payout`, which pays the wrong network.
  assert.throws(
    () => planVaultPayout(request({ destinationChainId: BASE_SEPOLIA })),
    /needs a resolved CCTP route and fee quote/,
  );
  const { route } = await forwardedQuote();
  assert.throws(
    () => planVaultPayout(request({ destinationChainId: BASE_SEPOLIA }), route),
    /needs a resolved CCTP route and fee quote/,
  );
});

test("the amount is passed as a bigint of base units, not a string", () => {
  const plan = planVaultPayout(request({ amount: "250000" }));
  assert.equal(typeof plan.args[2], "bigint");
  assert.equal(plan.args[2], 250_000n);
});
