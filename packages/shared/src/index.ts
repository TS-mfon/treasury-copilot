import { defineChain, type Abi, type Address, type Chain, type Hex, type TypedData } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  codex,
  codexTestnet,
  hyperEvm,
  ink,
  inkSepolia,
  linea,
  lineaSepolia,
  mainnet,
  monad,
  monadTestnet,
  optimism,
  optimismSepolia,
  // viem also exports `plume`, which is "Plume (Legacy)" (98865) with a dead RPC. The live
  // chain is 98866.
  plumeMainnet,
  polygon,
  polygonAmoy,
  sei,
  seiTestnet,
  sepolia,
  sonic,
  unichain,
  unichainSepolia,
  worldchain,
  worldchainSepolia,
  xdc,
} from "viem/chains";

export type SupportedChainKey =
  // Settlement chains: a policy can be bound to these and pay out of them.
  | "baseSepolia"
  | "base"
  | "arbitrumSepolia"
  | "arcTestnet"
  | "arc"
  // CCTP payout destinations: an approved payment can be delivered here, but no treasury lives
  // here. See `destinationOnly`.
  | "ethereum"
  | "ethereumSepolia"
  | "avalanche"
  | "avalancheFuji"
  | "optimism"
  | "optimismSepolia"
  | "arbitrum"
  | "polygon"
  | "polygonAmoy"
  | "unichain"
  | "unichainSepolia"
  | "linea"
  | "lineaSepolia"
  | "codex"
  | "codexTestnet"
  | "sonic"
  | "worldchain"
  | "worldchainSepolia"
  | "monad"
  | "monadTestnet"
  | "sei"
  | "seiTestnet"
  | "xdc"
  | "hyperEvm"
  | "ink"
  | "inkSepolia"
  | "plume";
export type SupportedTokenSymbol = "USDC";

/**
 * How an approved payout actually reaches the chain.
 *
 * `delegated-7710` redelegates the owner's ERC-7715 MetaMask permission to the 1Shot relayer,
 * which moves USDC out of the owner's smart account. It requires the MetaMask Delegation
 * Framework and a 1Shot capability entry on the target chain.
 *
 * `arc-vault` calls `payout` on an AgentTreasury contract the owner deployed, signed by the
 * platform's dedicated Arc executor. Arc has neither the delegation framework nor 1Shot support,
 * so it settles this way.
 */
export type ExecutionBackend = "delegated-7710" | "arc-vault";

/** Circle CCTP V2 wiring. Addresses are deterministic and identical across chains. */
export interface CctpConfig {
  domain: number;
  tokenMessenger: Address;
  messageTransmitter: Address;
  attestationApiUrl: string;
}

export interface TokenConfig {
  symbol: SupportedTokenSymbol;
  address: Address | undefined;
  decimals: number;
  kind: "erc20" | "native";
}

export interface ChainConfig {
  key: SupportedChainKey;
  name: string;
  chainId: number;
  explorerUrl: string;
  nativeSymbol: string;
  /** Decimals of the chain's gas asset. On Arc the gas asset is native USDC at 18 decimals. */
  nativeDecimals: number;
  viemChain: Chain;
  usdcAddress: Address | undefined;
  tokens: Partial<Record<SupportedTokenSymbol, TokenConfig>>;
  executionBackend: ExecutionBackend;
  /**
   * 1Shot relayer that serves this chain, for `delegated-7710` settlement.
   *
   * This cannot be a single global setting. 1Shot runs two relayers and they are split by
   * environment: the production relayer serves mainnets (Ethereum, Base, Arbitrum, OP, Polygon)
   * and returns `{}` for Base Sepolia, while the dev relayer serves Base Sepolia and returns
   * `{}` for every mainnet. One URL for the whole app therefore cannot support both Base
   * Sepolia and Base Mainnet, which is why the relayer is resolved per chain.
   */
  relayerUrl?: string;
  /** Undefined when CCTP does not support the chain, which disables cross-chain routes. */
  cctp?: CctpConfig;
  /** AgentTreasuryFactory, only meaningful for `arc-vault` chains. */
  vaultFactory?: Address;
  /** Max blocks per `eth_getLogs` call. Arc's public endpoints cap this at 9,999. */
  maxLogRange?: number;
  /** Minimum `maxFeePerGas` the mempool will accept, in wei. Arc enforces a 20 Gwei floor. */
  minMaxFeePerGas?: bigint;
  /**
   * True when the chain can receive a CCTP payment but can never hold a treasury.
   *
   * Treasury Copilot settles from Base/Arbitrum (ERC-7715) or Arc (vault). Every other CCTP
   * chain is a payout destination only, and binding a policy to one must fail loudly rather
   * than produce a policy that can never execute.
   */
  destinationOnly?: boolean;
}

/**
 * CCTP V2 contract addresses. See docs/arc.md for provenance; these are protocol constants
 * deployed at the same address on every supported chain, so they are not environment-configured.
 */
const CCTP_TESTNET = {
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
  attestationApiUrl: "https://iris-api-sandbox.circle.com",
} as const;

const CCTP_MAINNET = {
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address,
  messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address,
  attestationApiUrl: "https://iris-api.circle.com",
} as const;

/**
 * CCTP domain ids, which are independent of EVM chain ids.
 *
 * Only domains Circle's **Forwarding Service** will deliver to are listed. Treasury Copilot's
 * vault calls `depositForBurnWithHook` with the forwarding hook so Circle performs the
 * destination mint; without forwarding we would need an executor key and gas on the destination
 * chain, which we do not have. X Layer (domain 37) is the concrete exclusion: CCTP supports it,
 * forwarding does not. `scripts/verify-cctp-candidates.mts` asserts this against Circle's live
 * fee API and keeps X Layer as a negative control.
 */
export const CCTP_DOMAIN = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  unichain: 10,
  linea: 11,
  codex: 12,
  sonic: 13,
  worldchain: 14,
  monad: 15,
  sei: 16,
  xdc: 18,
  hyperEvm: 19,
  ink: 21,
  plume: 22,
  arc: 26,
} as const;

/**
 * 1Shot relayer endpoints, verified by calling `relayer_getCapabilities` on each.
 *
 * Production answers for chain 1, 8453, 42161, 10 and 137. Dev answers for 84532. Neither
 * answers for Arbitrum Sepolia (421614), so a delegation there cannot execute no matter how the
 * allowlist is set — `requireChainCapability` reports that at the boundary.
 */
export const ONE_SHOT_RELAYER_MAINNET = "https://relayer.1shotapi.com/relayers";
export const ONE_SHOT_RELAYER_TESTNET = "https://relayer.1shotapi.dev/relayers";

/** Arc's canonical USDC ERC-20 interface. Reports 6 decimals; native USDC gas uses 18. */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;

/**
 * Canonical USDC addresses for the settlement chains.
 *
 * These were read off each chain (contract exists, `decimals() == 6`, `symbol() == "USDC"`) by
 * `scripts/verify-cctp-candidates.mts`, and the Base Mainnet value is the one 1Shot's production
 * relayer independently advertises. Kept as defaults so a missing env var cannot silently leave a
 * chain with no token address; the env var still overrides.
 */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
export const ARBITRUM_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;

/** Arc rejects transactions below a 20 Gwei maxFeePerGas. */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

/** Arc public RPC endpoints cap `eth_getLogs` at 9,999 blocks per call. */
export const ARC_MAX_LOG_RANGE = 9_999;

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
});

export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.mainnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});

function token(symbol: SupportedTokenSymbol, address: Address | undefined, decimals: number, kind: "erc20" | "native" = "erc20"): TokenConfig {
  return { symbol, address, decimals, kind };
}


/**
 * A CCTP payout destination that never holds a treasury.
 *
 * `executionBackend` is required by the type but meaningless here, so it is paired with
 * `destinationOnly` and `settlementBackendForChainId` refuses these chains.
 */
function destinationChain(
  key: SupportedChainKey,
  name: string,
  viemChain: Chain,
  explorerUrl: string,
  usdc: Address,
  cctpDomain: number,
  cctp: typeof CCTP_TESTNET | typeof CCTP_MAINNET,
): ChainConfig {
  return {
    key,
    name,
    chainId: viemChain.id,
    explorerUrl,
    nativeSymbol: viemChain.nativeCurrency.symbol,
    nativeDecimals: viemChain.nativeCurrency.decimals,
    viemChain,
    usdcAddress: usdc,
    tokens: { USDC: token("USDC", usdc, 6) },
    executionBackend: "delegated-7710",
    destinationOnly: true,
    cctp: { domain: cctpDomain, ...cctp },
  };
}

export const SUPPORTED_CHAINS: Record<SupportedChainKey, ChainConfig> = {
  baseSepolia: {
    key: "baseSepolia",
    name: "Base Sepolia",
    chainId: baseSepolia.id,
    explorerUrl: "https://sepolia.basescan.org",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    viemChain: baseSepolia,
    executionBackend: "delegated-7710",
    relayerUrl: ONE_SHOT_RELAYER_TESTNET,
    cctp: { domain: CCTP_DOMAIN.base, ...CCTP_TESTNET },
    usdcAddress: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC as Address | undefined) ?? BASE_SEPOLIA_USDC,
    tokens: {
      USDC: token("USDC", (process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC as Address | undefined) ?? BASE_SEPOLIA_USDC, Number(process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC_DECIMALS ?? 6)),
    },
  },
  base: {
    key: "base",
    name: "Base Mainnet",
    chainId: base.id,
    explorerUrl: "https://basescan.org",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    viemChain: base,
    executionBackend: "delegated-7710",
    relayerUrl: ONE_SHOT_RELAYER_MAINNET,
    cctp: { domain: CCTP_DOMAIN.base, ...CCTP_MAINNET },
    usdcAddress: (process.env.NEXT_PUBLIC_BASE_USDC as Address | undefined) ?? BASE_USDC,
    tokens: {
      USDC: token("USDC", (process.env.NEXT_PUBLIC_BASE_USDC as Address | undefined) ?? BASE_USDC, Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS ?? 6)),
    },
  },
  arbitrumSepolia: {
    key: "arbitrumSepolia",
    name: "Arbitrum Sepolia",
    chainId: arbitrumSepolia.id,
    explorerUrl: "https://sepolia.arbiscan.io",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    viemChain: arbitrumSepolia,
    executionBackend: "delegated-7710",
    // No 1Shot relayer answers for 421614 in either environment, so a delegation here cannot
    // execute. Left unset deliberately rather than pointed at a relayer that returns `{}`.
    cctp: { domain: CCTP_DOMAIN.arbitrum, ...CCTP_TESTNET },
    usdcAddress: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC as Address | undefined) ?? ARBITRUM_SEPOLIA_USDC,
    tokens: {
      USDC: token("USDC", (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC as Address | undefined) ?? ARBITRUM_SEPOLIA_USDC, Number(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC_DECIMALS ?? 6)),
    },
  },
  arcTestnet: {
    key: "arcTestnet",
    name: "Arc Testnet",
    chainId: 5042002,
    explorerUrl: "https://explorer.testnet.arc.io",
    // Arc's gas asset is native USDC at 18 decimals, while the ERC-20 interface below
    // reports 6. They are the same balance viewed at different precision.
    nativeSymbol: "USDC",
    nativeDecimals: 18,
    viemChain: arcTestnet,
    usdcAddress: (process.env.NEXT_PUBLIC_ARC_TESTNET_USDC as Address | undefined) ?? ARC_USDC_ADDRESS,
    tokens: {
      USDC: token("USDC", (process.env.NEXT_PUBLIC_ARC_TESTNET_USDC as Address | undefined) ?? ARC_USDC_ADDRESS, 6),
    },
    executionBackend: "arc-vault",
    cctp: { domain: CCTP_DOMAIN.arc, ...CCTP_TESTNET },
    vaultFactory: process.env.NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY as Address | undefined,
    maxLogRange: ARC_MAX_LOG_RANGE,
    minMaxFeePerGas: ARC_MIN_MAX_FEE_PER_GAS,
  },
  arc: {
    key: "arc",
    name: "Arc",
    chainId: 5042,
    explorerUrl: "https://explorer.arc.io",
    nativeSymbol: "USDC",
    nativeDecimals: 18,
    viemChain: arc,
    usdcAddress: (process.env.NEXT_PUBLIC_ARC_USDC as Address | undefined) ?? ARC_USDC_ADDRESS,
    tokens: {
      USDC: token("USDC", (process.env.NEXT_PUBLIC_ARC_USDC as Address | undefined) ?? ARC_USDC_ADDRESS, 6),
    },
    executionBackend: "arc-vault",
    cctp: { domain: CCTP_DOMAIN.arc, ...CCTP_MAINNET },
    vaultFactory: process.env.NEXT_PUBLIC_ARC_VAULT_FACTORY as Address | undefined,
    maxLogRange: ARC_MAX_LOG_RANGE,
    minMaxFeePerGas: ARC_MIN_MAX_FEE_PER_GAS,
  },
  // --- CCTP payout destinations -----------------------------------------------------------------
  // Every entry here is verified by scripts/verify-cctp-candidates.mts, which checks three
  // independent things against the thing itself: Circle's live fee API returns a forwarding fee
  // for the route, the USDC address is a real contract reporting 6 decimals when read on chain,
  // and viem has a chain definition whose RPC answers. X Layer is kept in that script as a
  // negative control and is expected to fail, because CCTP supports it but forwarding does not.
  //
  // Sonic has no testnet entry on purpose: Circle publishes two testnet USDC addresses for Sonic
  // and neither verified against any public Blaze RPC, so it would be a guess.
  ethereum: destinationChain(
    "ethereum", "Ethereum", mainnet, "https://etherscan.io",
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", CCTP_DOMAIN.ethereum, CCTP_MAINNET,
  ),
  ethereumSepolia: destinationChain(
    "ethereumSepolia", "Ethereum Sepolia", sepolia, "https://sepolia.etherscan.io",
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", CCTP_DOMAIN.ethereum, CCTP_TESTNET,
  ),
  avalanche: destinationChain(
    "avalanche", "Avalanche", avalanche, "https://snowtrace.io",
    "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", CCTP_DOMAIN.avalanche, CCTP_MAINNET,
  ),
  avalancheFuji: destinationChain(
    "avalancheFuji", "Avalanche Fuji", avalancheFuji, "https://testnet.snowtrace.io",
    "0x5425890298aed601595a70AB815c96711a31Bc65", CCTP_DOMAIN.avalanche, CCTP_TESTNET,
  ),
  optimism: destinationChain(
    "optimism", "OP Mainnet", optimism, "https://optimistic.etherscan.io",
    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", CCTP_DOMAIN.optimism, CCTP_MAINNET,
  ),
  optimismSepolia: destinationChain(
    "optimismSepolia", "OP Sepolia", optimismSepolia, "https://sepolia-optimism.etherscan.io",
    "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", CCTP_DOMAIN.optimism, CCTP_TESTNET,
  ),
  arbitrum: destinationChain(
    "arbitrum", "Arbitrum One", arbitrum, "https://arbiscan.io",
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", CCTP_DOMAIN.arbitrum, CCTP_MAINNET,
  ),
  polygon: destinationChain(
    "polygon", "Polygon PoS", polygon, "https://polygonscan.com",
    "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", CCTP_DOMAIN.polygon, CCTP_MAINNET,
  ),
  polygonAmoy: destinationChain(
    "polygonAmoy", "Polygon Amoy", polygonAmoy, "https://amoy.polygonscan.com",
    "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", CCTP_DOMAIN.polygon, CCTP_TESTNET,
  ),
  unichain: destinationChain(
    "unichain", "Unichain", unichain, "https://uniscan.xyz",
    "0x078D782b760474a361dDA0AF3839290b0EF57AD6", CCTP_DOMAIN.unichain, CCTP_MAINNET,
  ),
  unichainSepolia: destinationChain(
    "unichainSepolia", "Unichain Sepolia", unichainSepolia, "https://unichain-sepolia.blockscout.com",
    "0x31d0220469e10c4E71834a79b1f276d740d3768F", CCTP_DOMAIN.unichain, CCTP_TESTNET,
  ),
  linea: destinationChain(
    "linea", "Linea", linea, "https://lineascan.build",
    "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", CCTP_DOMAIN.linea, CCTP_MAINNET,
  ),
  lineaSepolia: destinationChain(
    "lineaSepolia", "Linea Sepolia", lineaSepolia, "https://sepolia.lineascan.build",
    "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7", CCTP_DOMAIN.linea, CCTP_TESTNET,
  ),
  codex: destinationChain(
    "codex", "Codex", codex, "https://explorer.codex.xyz",
    "0xd996633a415985DBd7D6D12f4A4343E31f5037cf", CCTP_DOMAIN.codex, CCTP_MAINNET,
  ),
  codexTestnet: destinationChain(
    "codexTestnet", "Codex Testnet", codexTestnet, "https://explorer.codex-stg.xyz",
    "0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f", CCTP_DOMAIN.codex, CCTP_TESTNET,
  ),
  sonic: destinationChain(
    "sonic", "Sonic", sonic, "https://sonicscan.org",
    "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", CCTP_DOMAIN.sonic, CCTP_MAINNET,
  ),
  worldchain: destinationChain(
    "worldchain", "World Chain", worldchain, "https://worldscan.org",
    "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", CCTP_DOMAIN.worldchain, CCTP_MAINNET,
  ),
  worldchainSepolia: destinationChain(
    "worldchainSepolia", "World Chain Sepolia", worldchainSepolia, "https://sepolia.worldscan.org",
    "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88", CCTP_DOMAIN.worldchain, CCTP_TESTNET,
  ),
  monad: destinationChain(
    "monad", "Monad", monad, "https://monadvision.com",
    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", CCTP_DOMAIN.monad, CCTP_MAINNET,
  ),
  monadTestnet: destinationChain(
    "monadTestnet", "Monad Testnet", monadTestnet, "https://testnet.monadexplorer.com",
    "0x534b2f3A21130d7a60830c2Df862319e593943A3", CCTP_DOMAIN.monad, CCTP_TESTNET,
  ),
  sei: destinationChain(
    "sei", "Sei", sei, "https://seiscan.io",
    "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", CCTP_DOMAIN.sei, CCTP_MAINNET,
  ),
  seiTestnet: destinationChain(
    "seiTestnet", "Sei Testnet", seiTestnet, "https://testnet.seiscan.io",
    "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", CCTP_DOMAIN.sei, CCTP_TESTNET,
  ),
  xdc: destinationChain(
    "xdc", "XDC", xdc, "https://xdcscan.com",
    "0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1", CCTP_DOMAIN.xdc, CCTP_MAINNET,
  ),
  hyperEvm: destinationChain(
    "hyperEvm", "HyperEVM", hyperEvm, "https://hyperscan.com",
    "0xb88339CB7199b77E23DB6E890353E22632Ba630f", CCTP_DOMAIN.hyperEvm, CCTP_MAINNET,
  ),
  ink: destinationChain(
    "ink", "Ink", ink, "https://explorer.inkonchain.com",
    "0x2D270e6886d130D724215A266106e6832161EAEd", CCTP_DOMAIN.ink, CCTP_MAINNET,
  ),
  inkSepolia: destinationChain(
    "inkSepolia", "Ink Sepolia", inkSepolia, "https://explorer-sepolia.inkonchain.com",
    "0xFabab97dCE620294D2B0b0e46C68964e326300Ac", CCTP_DOMAIN.ink, CCTP_TESTNET,
  ),
  plume: destinationChain(
    "plume", "Plume", plumeMainnet, "https://explorer.plume.org",
    "0x222365EF19F7947e5484218551B56bb3965Aa7aF", CCTP_DOMAIN.plume, CCTP_MAINNET,
  ),
};

/**
 * Every chain an approved payment can be delivered to from a given settlement chain.
 *
 * Restricted to chains sharing the settlement chain's Circle environment, because a route whose
 * endpoints straddle the sandbox and production attestation services would never be attested. This
 * is the default destination set for a new policy: the agent picks the network per request, and the
 * owner constrains it through policy text and the on-chain review rather than a hand-kept list.
 */
export function cctpDestinationChainIds(settlementChainId: number): number[] {
  const settlement = chainById(settlementChainId);
  if (!settlement?.cctp) return [];
  const host = settlement.cctp.attestationApiUrl;
  return Object.values(SUPPORTED_CHAINS)
    .filter((chain) => chain.cctp?.attestationApiUrl === host)
    .map((chain) => chain.chainId)
    .sort((a, b) => a - b);
}

export function chainById(chainId: number): ChainConfig | undefined {
  return Object.values(SUPPORTED_CHAINS).find((chain) => chain.chainId === chainId);
}

export function tokenForChain(key: SupportedChainKey, symbol: SupportedTokenSymbol): TokenConfig {
  const config = SUPPORTED_CHAINS[key].tokens[symbol];
  if (!config || (config.kind === "erc20" && !config.address)) throw new Error(`${symbol} is not configured for ${SUPPORTED_CHAINS[key].name}`);
  return config;
}

export function tokenForChainId(chainId: number, symbol: SupportedTokenSymbol): TokenConfig {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  const config = chain.tokens[symbol];
  if (!config || (config.kind === "erc20" && !config.address)) throw new Error(`${symbol} is not configured for ${chain.name}`);
  return config;
}

export const treasuryAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_relayer", type: "address" },
      { name: "_token", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "payout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setRelayer",
    stateMutability: "nonpayable",
    inputs: [{ name: "_relayer", type: "address" }],
    outputs: []
  },
  {
    type: "function",
    name: "setAuthorizedAgent",
    stateMutability: "nonpayable",
    inputs: [{ name: "_authorizedAgent", type: "address" }],
    outputs: []
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "relayer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "authorizedAgent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "isNativeAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "executed",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { indexed: true, name: "requestId", type: "bytes32" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" }
    ]
  }
] as const satisfies Abi;

export const treasuryFactoryAbi = [
  {
    type: "function",
    name: "createTreasury",
    stateMutability: "nonpayable",
    inputs: [
      { name: "relayer", type: "address" },
      { name: "token", type: "address" }
    ],
    outputs: [{ name: "clone", type: "address" }]
  },
  {
    type: "event",
    name: "TreasuryCreated",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "treasury", type: "address" },
      { indexed: false, name: "relayer", type: "address" },
      { indexed: false, name: "token", type: "address" }
    ]
  }
] as const satisfies Abi;

/**
 * AgentTreasury: the Arc settlement vault Treasury Copilot deploys and owns.
 * Unlike `treasuryAbi`, this contract is in the live execution path on Arc.
 */
export const agentTreasuryAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_executor", type: "address" },
      { name: "_token", type: "address" },
      { name: "_tokenMessenger", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "payout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "payoutCrossChain",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  { type: "function", name: "fundFeeReserve", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "releaseFeeReserve", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "setFeeReserveCap", stateMutability: "nonpayable", inputs: [{ name: "cap", type: "uint256" }], outputs: [] },
  { type: "function", name: "setExecutor", stateMutability: "nonpayable", inputs: [{ name: "_executor", type: "address" }], outputs: [] },
  { type: "function", name: "setTokenMessenger", stateMutability: "nonpayable", inputs: [{ name: "_tokenMessenger", type: "address" }], outputs: [] },
  { type: "function", name: "setPaused", stateMutability: "nonpayable", inputs: [{ name: "_paused", type: "bool" }], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "executor", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenMessenger", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "feeReserve", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "feeReserveCap", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "availableBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "executed", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { indexed: true, name: "requestId", type: "bytes32" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "CrossChainInitiated",
    inputs: [
      { indexed: true, name: "requestId", type: "bytes32" },
      { indexed: true, name: "destinationDomain", type: "uint32" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "maxFee", type: "uint256" },
      { indexed: false, name: "forwarded", type: "bool" },
      { indexed: false, name: "timestamp", type: "uint256" }
    ]
  }
] as const satisfies Abi;

export const agentTreasuryFactoryAbi = [
  {
    type: "function",
    name: "createTreasury",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executor", type: "address" },
      { name: "token", type: "address" }
    ],
    outputs: [{ name: "clone", type: "address" }]
  },
  { type: "function", name: "treasuryImplementation", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenMessenger", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "event",
    name: "TreasuryCreated",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "treasury", type: "address" },
      { indexed: false, name: "executor", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "tokenMessenger", type: "address" }
    ]
  }
] as const satisfies Abi;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
] as const satisfies Abi;

export const treasuryRequestTypes = {
  TreasuryRequest: [
    { name: "policy", type: "address" },
    { name: "delegatedAccount", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amountAtto", type: "uint256" },
    { name: "category", type: "string" },
    { name: "justificationHash", type: "bytes32" },
    { name: "requestId", type: "bytes32" },
    { name: "deadline", type: "uint256" }
  ]
} as const satisfies TypedData;

export const ownerActionTypes = {
  OwnerAction: [
    { name: "owner", type: "address" },
    { name: "action", type: "string" },
    { name: "policy", type: "address" },
    { name: "agent", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "token", type: "address" },
    { name: "payloadHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const satisfies TypedData;

export interface TreasuryRequestMessage {
  policy: Address;
  delegatedAccount: Address;
  recipient: Address;
  amountAtto: bigint;
  category: string;
  justificationHash: Hex;
  requestId: Hex;
  deadline: bigint;
}

export function buildTreasuryRequestDomain(
  chainId: number,
  policyAddress: Address
) {
  return {
    name: "Treasury Copilot",
    version: "1",
    chainId,
    verifyingContract: policyAddress,
  } as const;
}

export function buildOwnerActionDomain(chainId: number, registryAddress: Address) {
  return {
    name: "Treasury Copilot Owner",
    version: "1",
    chainId,
    verifyingContract: registryAddress,
  } as const;
}
