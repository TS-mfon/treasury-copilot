import assert from "node:assert/strict";
import test from "node:test";
import {
  CctpUnsupportedError,
  FINALITY_FAST,
  FINALITY_STANDARD,
  FORWARDING_HOOK_DATA,
  fetchAttestation,
  quoteFee,
  resolveRoute,
  toBytes32,
} from "../src/lib/cctp";

const ARC_TESTNET = 5042002;
const BASE_SEPOLIA = 84532;
const ARC_MAINNET = 5042;
const X_LAYER_TESTNET = 1952;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// --- route resolution ---------------------------------------------------------------------------

test("a supported testnet route resolves to Circle's sandbox with both domains", () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  assert.equal(route.sourceDomain, 26);
  assert.equal(route.destinationDomain, 6);
  assert.equal(route.attestationApiUrl, "https://iris-api-sandbox.circle.com");
  assert.equal(route.tokenMessenger, "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
  assert.equal(route.messageTransmitter, "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");
});

test("mixing a testnet and a mainnet endpoint is refused at the environment stage", () => {
  // Circle would never attest such a message, so this must fail before any burn.
  try {
    resolveRoute(ARC_TESTNET, 8453);
    assert.fail("expected a cross-environment route to be refused");
  } catch (error) {
    assert.ok(error instanceof CctpUnsupportedError);
    assert.equal(error.stage, "environment");
  }
});

test("a chain without CCTP is refused and names which side is unsupported", () => {
  try {
    resolveRoute(ARC_TESTNET, X_LAYER_TESTNET);
    assert.fail("expected an unsupported destination to be refused");
  } catch (error) {
    assert.ok(error instanceof CctpUnsupportedError);
    assert.equal(error.stage, "destination");
  }
  try {
    resolveRoute(X_LAYER_TESTNET, ARC_TESTNET);
    assert.fail("expected an unsupported source to be refused");
  } catch (error) {
    assert.equal((error as CctpUnsupportedError).stage, "source");
  }
});

test("a same-domain route is refused because no bridge is needed", () => {
  try {
    resolveRoute(ARC_TESTNET, ARC_TESTNET);
    assert.fail("expected a same-domain route to be refused");
  } catch (error) {
    assert.equal((error as CctpUnsupportedError).stage, "route");
  }
});

test("an unknown chain id is refused rather than defaulting to a domain", () => {
  assert.throws(() => resolveRoute(999999, BASE_SEPOLIA), /Unsupported chain id/);
});

test("mainnet routes use Circle's production attestation host and contracts", () => {
  const route = resolveRoute(ARC_MAINNET, 8453);
  assert.equal(route.attestationApiUrl, "https://iris-api.circle.com");
  assert.equal(route.tokenMessenger, "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
});

// --- fee quoting --------------------------------------------------------------------------------

const FEE_BODY = [
  { finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 54322, med: 54322, high: 54662 } },
  { finalityThreshold: 2000, minimumFee: 5, forwardFee: { low: 100, med: 150, high: 200 } },
];

test("a forwarded quote sums the protocol fee and the highest forwarding tier", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const quote = await quoteFee(route, {
    forwarded: true,
    finalityThreshold: FINALITY_FAST,
    fetchImpl: async () => jsonResponse(FEE_BODY),
  });
  // The highest tier is used so a fee that rises between quote and burn cannot strand the transfer.
  assert.equal(quote.maxFee, 54662n);
  assert.equal(quote.protocolFee, 0n);
  assert.equal(quote.forwardFee, 54662n);
  assert.equal(quote.minFinalityThreshold, FINALITY_FAST);
  assert.equal(quote.forwarded, true);
});

test("the requested finality tier selects its own fee row", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const quote = await quoteFee(route, {
    forwarded: true,
    finalityThreshold: FINALITY_STANDARD,
    fetchImpl: async () => jsonResponse(FEE_BODY),
  });
  assert.equal(quote.minFinalityThreshold, FINALITY_STANDARD);
  assert.equal(quote.maxFee, 205n);
});

test("a direct-mint quote excludes the forwarding fee", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const quote = await quoteFee(route, {
    forwarded: false,
    fetchImpl: async () => jsonResponse(FEE_BODY),
  });
  assert.equal(quote.forwardFee, 0n);
  assert.equal(quote.maxFee, 0n);
  assert.equal(quote.forwarded, false);
});

test("a route Circle does not forward is refused at the forwarding stage", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  // Burning with forwarding hook data Circle will not act on would leave funds unminted.
  await assert.rejects(
    () => quoteFee(route, { forwarded: true, fetchImpl: async () => jsonResponse([{ finalityThreshold: 1000, minimumFee: 0 }]) }),
    (error: unknown) => error instanceof CctpUnsupportedError && error.stage === "forwarding",
  );
});

test("a failed or empty fee lookup is refused rather than defaulted to zero", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  await assert.rejects(
    () => quoteFee(route, { fetchImpl: async () => jsonResponse({ error: "nope" }, 500) }),
    (error: unknown) => error instanceof CctpUnsupportedError && error.stage === "fee",
  );
  await assert.rejects(
    () => quoteFee(route, { fetchImpl: async () => jsonResponse([]) }),
    (error: unknown) => error instanceof CctpUnsupportedError && error.stage === "fee",
  );
});

test("the fee request targets Circle's route-specific endpoint with the forward flag", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  let seen = "";
  await quoteFee(route, {
    forwarded: true,
    fetchImpl: async (url) => {
      seen = String(url);
      return jsonResponse(FEE_BODY);
    },
  });
  assert.ok(seen.includes("/v2/burn/USDC/fees/26/6"), seen);
  assert.ok(seen.includes("forward=true"), seen);
});

// --- attestation --------------------------------------------------------------------------------

const BURN = "0x414ef53f33a270d5c3700463a34375187933074f580a85e7734f4a7a955d7825" as const;

test("a not-yet-indexed burn reports undefined rather than failing", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const result = await fetchAttestation(route, BURN, {
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  assert.equal(result, undefined);
});

test("a forwarded mint is complete and carries the destination transaction", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const result = await fetchAttestation(route, BURN, {
    fetchImpl: async () => jsonResponse({
      messages: [{ status: "complete", attestation: "0xabc", forwardTxHash: "0xdef" }],
    }),
  });
  assert.equal(result?.complete, true);
  assert.equal(result?.forwardTxHash, "0xdef");
});

test("an attested but unminted transfer is not yet complete", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  const result = await fetchAttestation(route, BURN, {
    fetchImpl: async () => jsonResponse({ messages: [{ status: "pending", attestation: "0xabc" }] }),
  });
  // Reporting this as complete would mark a request paid before the payee could spend it.
  assert.equal(result?.complete, false);
  assert.equal(result?.attestation, "0xabc");
  assert.equal(result?.forwardTxHash, undefined);
});

test("an attestation server error is surfaced, not swallowed", async () => {
  const route = resolveRoute(ARC_TESTNET, BASE_SEPOLIA);
  await assert.rejects(
    () => fetchAttestation(route, BURN, { fetchImpl: async () => jsonResponse({}, 503) }),
    (error: unknown) => error instanceof CctpUnsupportedError && error.stage === "attestation",
  );
});

// --- encoding -----------------------------------------------------------------------------------

test("an address is left-padded into the bytes32 form CCTP expects", () => {
  assert.equal(
    toBytes32("0xEd9EDd8586b20524CafA4F568413C504C9B03172"),
    "0x000000000000000000000000ed9edd8586b20524cafa4f568413c504c9b03172",
  );
  assert.equal(toBytes32("0x0000000000000000000000000000000000000000").length, 66);
});

test("the forwarding hook data is Circle's cctp-forward marker", () => {
  assert.equal(
    Buffer.from(FORWARDING_HOOK_DATA.slice(2), "hex").toString("utf8").replace(/\0+$/, ""),
    "cctp-forward",
  );
});
