import { defineChain, type Abi, type Address, type Chain, type Hex, type TypedData } from "viem";
import { arbitrumSepolia, base, baseSepolia } from "viem/chains";

export type SupportedChainKey =
  | "baseSepolia"
  | "base"
  | "arbitrumSepolia"
  | "xLayer"
  | "xLayerTestnet"
  | "arcTestnet"
  | "arc";
export type SupportedTokenSymbol = "USDC" | "OKB";

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
  /** Undefined when CCTP does not support the chain, which disables cross-chain routes. */
  cctp?: CctpConfig;
  /** AgentTreasuryFactory, only meaningful for `arc-vault` chains. */
  vaultFactory?: Address;
  /** Max blocks per `eth_getLogs` call. Arc's public endpoints cap this at 9,999. */
  maxLogRange?: number;
  /** Minimum `maxFeePerGas` the mempool will accept, in wei. Arc enforces a 20 Gwei floor. */
  minMaxFeePerGas?: bigint;
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

/** CCTP domain ids, which are independent of EVM chain ids. */
export const CCTP_DOMAIN = {
  ethereum: 0,
  arbitrum: 3,
  base: 6,
  arc: 26,
} as const;

/** Arc's canonical USDC ERC-20 interface. Reports 6 decimals; native USDC gas uses 18. */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;

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

export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_X_LAYER_RPC_URL ?? "https://rpc.xlayer.tech"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
});

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_X_LAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer-test" },
  },
});

function token(symbol: SupportedTokenSymbol, address: Address | undefined, decimals: number, kind: "erc20" | "native" = "erc20"): TokenConfig {
  return { symbol, address, decimals, kind };
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
    cctp: { domain: CCTP_DOMAIN.base, ...CCTP_TESTNET },
    usdcAddress: process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC_DECIMALS ?? 6)),
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
    cctp: { domain: CCTP_DOMAIN.base, ...CCTP_MAINNET },
    usdcAddress: process.env.NEXT_PUBLIC_BASE_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_BASE_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS ?? 6)),
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
    cctp: { domain: CCTP_DOMAIN.arbitrum, ...CCTP_TESTNET },
    usdcAddress: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC_DECIMALS ?? 6)),
    },
  },
  xLayer: {
    key: "xLayer",
    name: "X Layer",
    chainId: 196,
    explorerUrl: "https://www.oklink.com/xlayer",
    nativeSymbol: "OKB",
    nativeDecimals: 18,
    viemChain: xLayer,
    executionBackend: "delegated-7710",
    usdcAddress: process.env.NEXT_PUBLIC_X_LAYER_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_X_LAYER_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_X_LAYER_USDC_DECIMALS ?? 6)),
      OKB: token("OKB", undefined, 18, "native"),
    },
  },
  xLayerTestnet: {
    key: "xLayerTestnet",
    name: "X Layer Testnet",
    chainId: 1952,
    explorerUrl: "https://www.oklink.com/xlayer-test",
    nativeSymbol: "OKB",
    nativeDecimals: 18,
    viemChain: xLayerTestnet,
    executionBackend: "delegated-7710",
    usdcAddress: process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC_DECIMALS ?? 6)),
      OKB: token("OKB", undefined, 18, "native"),
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
};

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
