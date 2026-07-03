import { arbitrumSepolia, baseSepolia } from "viem/chains";
import type { Abi, Address, Hex, TypedData } from "viem";

export type SupportedChainKey = "baseSepolia" | "arbitrumSepolia" | "xLayer";

export interface ChainConfig {
  key: SupportedChainKey;
  name: string;
  chainId: number;
  explorerUrl: string;
  nativeSymbol: string;
  viemChain: typeof baseSepolia | typeof arbitrumSepolia | undefined;
  usdcAddress: Address | undefined;
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
  },
  arbitrumSepolia: {
    key: "arbitrumSepolia",
    name: "Arbitrum Sepolia",
    chainId: arbitrumSepolia.id,
    explorerUrl: "https://sepolia.arbiscan.io",
    nativeSymbol: "ETH",
    viemChain: arbitrumSepolia,
    usdcAddress: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_USDC as Address | undefined,
  },
  xLayer: {
    key: "xLayer",
    name: "X Layer",
    chainId: 196,
    explorerUrl: "https://www.oklink.com/xlayer",
    nativeSymbol: "OKB",
    viemChain: undefined,
    usdcAddress: process.env.NEXT_PUBLIC_X_LAYER_USDC as Address | undefined,
  },
};

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
    { name: "treasury", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amountAtto", type: "uint256" },
    { name: "category", type: "string" },
    { name: "justificationHash", type: "bytes32" },
    { name: "requestId", type: "bytes32" },
    { name: "deadline", type: "uint256" }
  ]
} as const satisfies TypedData;

export interface TreasuryRequestMessage {
  policy: Address;
  treasury: Address;
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
