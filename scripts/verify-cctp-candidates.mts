/**
 * Verify CCTP destination candidates before they enter the chain registry.
 *
 * A destination is only usable by Treasury Copilot if three independent things hold, and each is
 * checked against the thing itself rather than a document:
 *
 *   1. Circle's Forwarding Service will deliver to it. Our vault calls `depositForBurnWithHook`
 *      with the forwarding hook, so Circle performs the destination mint. Without forwarding we
 *      would need an executor key and gas on that chain, which we do not have. X Layer is the
 *      concrete case: CCTP supports it, forwarding does not, so it cannot be a destination.
 *   2. The USDC address is a real contract reporting 6 decimals, read from the chain.
 *   3. viem has a chain definition with a working public RPC, so the app can read balances.
 *
 * Run: npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp-candidates.mts
 */
import { createPublicClient, http, getAddress, type Chain } from "viem";
import * as chains from "viem/chains";

const ARC_DOMAIN = 26;
const MAINNET_API = "https://iris-api.circle.com";
const TESTNET_API = "https://iris-api-sandbox.circle.com";

interface Candidate {
  key: string;
  name: string;
  viem: Chain;
  usdc: string;
  domain: number;
  env: "mainnet" | "testnet";
  /** Override when viem's bundled public RPC is rate-limited or dead. */
  rpc?: string;
}

const CANDIDATES: Candidate[] = [
  // --- mainnet ------------------------------------------------------------------------------
  { key: "ethereum", name: "Ethereum", viem: chains.mainnet, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", domain: 0, env: "mainnet", rpc: "https://ethereum-rpc.publicnode.com" },
  { key: "avalanche", name: "Avalanche", viem: chains.avalanche, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", domain: 1, env: "mainnet" },
  { key: "optimism", name: "OP Mainnet", viem: chains.optimism, usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", domain: 2, env: "mainnet" },
  { key: "arbitrum", name: "Arbitrum One", viem: chains.arbitrum, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", domain: 3, env: "mainnet" },
  { key: "base", name: "Base", viem: chains.base, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", domain: 6, env: "mainnet" },
  { key: "polygon", name: "Polygon PoS", viem: chains.polygon, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", domain: 7, env: "mainnet" },
  { key: "unichain", name: "Unichain", viem: chains.unichain, usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", domain: 10, env: "mainnet" },
  { key: "linea", name: "Linea", viem: chains.linea, usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", domain: 11, env: "mainnet" },
  { key: "codex", name: "Codex", viem: chains.codex, usdc: "0xd996633a415985DBd7D6D12f4A4343E31f5037cf", domain: 12, env: "mainnet" },
  { key: "sonic", name: "Sonic", viem: chains.sonic, usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", domain: 13, env: "mainnet" },
  { key: "worldchain", name: "World Chain", viem: chains.worldchain, usdc: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", domain: 14, env: "mainnet" },
  { key: "monad", name: "Monad", viem: chains.monad, usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", domain: 15, env: "mainnet" },
  { key: "sei", name: "Sei", viem: chains.sei, usdc: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", domain: 16, env: "mainnet" },
  { key: "xdc", name: "XDC", viem: chains.xdc, usdc: "0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1", domain: 18, env: "mainnet" },
  { key: "hyperEvm", name: "HyperEVM", viem: chains.hyperEvm, usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", domain: 19, env: "mainnet" },
  { key: "ink", name: "Ink", viem: chains.ink, usdc: "0x2D270e6886d130D724215A266106e6832161EAEd", domain: 21, env: "mainnet" },
  // viem exports two: `plume` is "Plume (Legacy)" at 98865, `plumeMainnet` is the live chain at
  // 98866. The legacy entry's RPC is dead, which is how the wrong one was caught.
  { key: "plume", name: "Plume", viem: chains.plumeMainnet, usdc: "0x222365EF19F7947e5484218551B56bb3965Aa7aF", domain: 22, env: "mainnet" },

  // --- testnet ------------------------------------------------------------------------------
  { key: "ethereumSepolia", name: "Ethereum Sepolia", viem: chains.sepolia, usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", domain: 0, env: "testnet" },
  { key: "avalancheFuji", name: "Avalanche Fuji", viem: chains.avalancheFuji, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", domain: 1, env: "testnet" },
  { key: "optimismSepolia", name: "OP Sepolia", viem: chains.optimismSepolia, usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", domain: 2, env: "testnet" },
  { key: "arbitrumSepolia", name: "Arbitrum Sepolia", viem: chains.arbitrumSepolia, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", domain: 3, env: "testnet" },
  { key: "baseSepolia", name: "Base Sepolia", viem: chains.baseSepolia, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", domain: 6, env: "testnet" },
  { key: "polygonAmoy", name: "Polygon Amoy", viem: chains.polygonAmoy, usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", domain: 7, env: "testnet", rpc: "https://polygon-amoy-bor-rpc.publicnode.com" },
  { key: "unichainSepolia", name: "Unichain Sepolia", viem: chains.unichainSepolia, usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F", domain: 10, env: "testnet" },
  { key: "lineaSepolia", name: "Linea Sepolia", viem: chains.lineaSepolia, usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7", domain: 11, env: "testnet" },
  { key: "codexTestnet", name: "Codex Testnet", viem: chains.codexTestnet, usdc: "0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f", domain: 12, env: "testnet" },
  { key: "sonicBlazeTestnet", name: "Sonic Blaze Testnet", viem: chains.sonicBlazeTestnet, usdc: "0xA4879Fed32Ecbef99399e5cbC247E533421C4eC6", domain: 13, env: "testnet" },
  { key: "worldchainSepolia", name: "World Chain Sepolia", viem: chains.worldchainSepolia, usdc: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88", domain: 14, env: "testnet" },
  { key: "monadTestnet", name: "Monad Testnet", viem: chains.monadTestnet, usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3", domain: 15, env: "testnet" },
  { key: "seiTestnet", name: "Sei Testnet", viem: chains.seiTestnet, usdc: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", domain: 16, env: "testnet" },
  { key: "inkSepolia", name: "Ink Sepolia", viem: chains.inkSepolia, usdc: "0xFabab97dCE620294D2B0b0e46C68964e326300Ac", domain: 21, env: "testnet" },

  // Sonic's testnet is deliberately absent. Circle publishes two testnet USDC addresses for Sonic
  // ("Sonic Testnet" and "Sonic Blaze Testnet") and neither verified against any public Blaze RPC,
  // so a Sonic testnet destination would be a guess. Sonic mainnet is verified and included.

  // Deliberately present and expected to FAIL the forwarding check, so the check is proven to
  // discriminate rather than pass everything. X Layer has CCTP but no Forwarding Service.
  { key: "xLayer", name: "X Layer (negative control)", viem: chains.xLayer, usdc: "0x74b7F16337b8972027F6196A17a631aC6dE26d22", domain: 37, env: "mainnet" },
];

const erc20 = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

async function forwardingSupported(env: "mainnet" | "testnet", domain: number): Promise<boolean | null> {
  const base = env === "mainnet" ? MAINNET_API : TESTNET_API;
  const url = `${base}/v2/burn/USDC/fees/${ARC_DOMAIN}/${domain}?forward=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    if (Array.isArray(body)) return body.some((tier) => tier?.forwardFee);
    return false;
  } catch {
    return null; // network problem, not a verdict
  }
}

async function usdcLooksRight(chain: Chain, usdc: string, rpc?: string) {
  const client = createPublicClient({ chain, transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
  const address = getAddress(usdc);
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { ok: false, detail: "no contract at address" };
  const decimals = await client.readContract({ address, abi: erc20, functionName: "decimals" });
  if (Number(decimals) !== 6) return { ok: false, detail: `decimals=${decimals}, expected 6` };
  let symbol = "";
  try { symbol = await client.readContract({ address, abi: erc20, functionName: "symbol" }); } catch { /* optional */ }
  return { ok: true, detail: `decimals=6${symbol ? ` symbol=${symbol}` : ""}` };
}

const pass: Candidate[] = [];
const fail: { candidate: Candidate; why: string }[] = [];
const skipped: { candidate: Candidate; why: string }[] = [];

for (const candidate of CANDIDATES) {
  const label = `${candidate.env.padEnd(7)} ${candidate.key.padEnd(20)} domain ${String(candidate.domain).padStart(2)}`;
  if (!candidate.viem) {
    skipped.push({ candidate, why: "no viem chain definition" });
    console.log(`SKIP  ${label}  no viem chain`);
    continue;
  }

  const forwarding = await forwardingSupported(candidate.env, candidate.domain);
  if (forwarding === null) {
    skipped.push({ candidate, why: "fee API unreachable" });
    console.log(`SKIP  ${label}  fee API unreachable`);
    continue;
  }
  if (!forwarding) {
    fail.push({ candidate, why: "Circle will not forward to this domain" });
    console.log(`FAIL  ${label}  no Forwarding Service`);
    continue;
  }

  let token: { ok: boolean; detail: string };
  try {
    token = await usdcLooksRight(candidate.viem, candidate.usdc, candidate.rpc);
  } catch (error) {
    skipped.push({ candidate, why: `RPC error: ${String(error).slice(0, 80)}` });
    console.log(`SKIP  ${label}  RPC unreachable`);
    continue;
  }
  if (!token.ok) {
    fail.push({ candidate, why: token.detail });
    console.log(`FAIL  ${label}  ${token.detail}`);
    continue;
  }

  pass.push(candidate);
  console.log(`OK    ${label}  chainId=${candidate.viem.id} ${token.detail}`);
}

console.log(`\n--- summary ---`);
console.log(`pass    ${pass.length}`);
console.log(`fail    ${fail.length}`);
console.log(`skipped ${skipped.length}`);

const xLayerVerdict = fail.find((f) => f.candidate.key === "xLayer");
if (!xLayerVerdict) {
  console.log(`\nCANDIDATE_VERIFY_SUSPECT: the X Layer negative control did not fail, so the`);
  console.log(`forwarding check is not discriminating and the pass list cannot be trusted.`);
  process.exit(1);
}
console.log(`\nnegative control held: X Layer rejected (${xLayerVerdict.why})`);

console.log(`\nREGISTRY-READY:`);
for (const c of pass) {
  console.log(`  ${c.env.padEnd(7)} ${c.key.padEnd(20)} id=${String(c.viem.id).padEnd(10)} domain=${String(c.domain).padStart(2)}  ${getAddress(c.usdc)}`);
}
console.log(`\nCANDIDATE_VERIFY_OK`);
