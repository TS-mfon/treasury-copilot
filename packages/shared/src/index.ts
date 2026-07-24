import { defineChain, type Abi, type Address, type Chain, type Hex, type TypedData } from "viem";
import { arbitrumSepolia, base, baseSepolia } from "viem/chains";

export type SupportedChainKey = "baseSepolia" | "base" | "arbitrumSepolia" | "xLayer" | "xLayerTestnet";
export type SupportedTokenSymbol = "USDC" | "OKB";

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
  viemChain: Chain;
  usdcAddress: Address | undefined;
  tokens: Partial<Record<SupportedTokenSymbol, TokenConfig>>;
}

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
    viemChain: baseSepolia,
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
    viemChain: base,
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
    viemChain: arbitrumSepolia,
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
    viemChain: xLayer,
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
    viemChain: xLayerTestnet,
    usdcAddress: process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC as Address | undefined,
    tokens: {
      USDC: token("USDC", process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC as Address | undefined, Number(process.env.NEXT_PUBLIC_X_LAYER_TESTNET_USDC_DECIMALS ?? 6)),
      OKB: token("OKB", undefined, 18, "native"),
    },
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
