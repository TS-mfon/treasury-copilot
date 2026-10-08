import { createPublicClient, http, parseAbi, type Address } from "viem";
import { chainById, SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";

/**
 * Circle Gateway: unified USDC balances across chains.
 *
 * Gateway is deployed on Arc, so this is a real capability rather than a stub. Availability is
 * probed against the live contracts instead of assumed from a config flag, because a configured
 * address that holds no code would otherwise be reported as working right up until a deposit.
 *
 * Addresses are Circle's published Gateway deployments; see docs/arc.md.
 */

export const GATEWAY_CONTRACTS: Partial<Record<SupportedChainKey, { wallet: Address; minter: Address }>> = {
  arcTestnet: {
    wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  },
  arc: {
    wallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
    minter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
  },
};

const gatewayWalletAbi = parseAbi([
  "function availableBalance(address token, address depositor) view returns (uint256)",
]);

export interface GatewayAvailability {
  chainId: number;
  chainName: string;
  supported: boolean;
  /** Names the exact stage that is unavailable, as the roadmap requires for a closed route. */
  unsupportedStage?: "not-deployed" | "no-contract-code" | "unknown-chain";
  wallet?: Address;
  minter?: Address;
}

function clientFor(key: SupportedChainKey) {
  const chain = SUPPORTED_CHAINS[key];
  const rpcUrl = key === "arcTestnet"
    ? process.env.ARC_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL
    : process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
  return createPublicClient({ chain: chain.viemChain, transport: http(rpcUrl) });
}

/** Probe whether Gateway is actually live on a chain by reading contract code. */
export async function probeGateway(key: SupportedChainKey): Promise<GatewayAvailability> {
  const chain = SUPPORTED_CHAINS[key];
  if (!chain) {
    return { chainId: 0, chainName: String(key), supported: false, unsupportedStage: "unknown-chain" };
  }
  const contracts = GATEWAY_CONTRACTS[key];
  if (!contracts) {
    return {
      chainId: chain.chainId,
      chainName: chain.name,
      supported: false,
      unsupportedStage: "not-deployed",
    };
  }

  const client = clientFor(key);
  const [walletCode, minterCode] = await Promise.all([
    client.getCode({ address: contracts.wallet }),
    client.getCode({ address: contracts.minter }),
  ]);
  const live = Boolean(walletCode && walletCode !== "0x" && minterCode && minterCode !== "0x");

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    supported: live,
    ...(live ? {} : { unsupportedStage: "no-contract-code" as const }),
    wallet: contracts.wallet,
    minter: contracts.minter,
  };
}

/**
 * Read a depositor's Gateway-available USDC on one chain.
 *
 * Returns undefined rather than zero when Gateway is unavailable, so a closed route is never
 * reported as an empty balance.
 */
export async function readGatewayBalance(
  key: SupportedChainKey,
  depositor: Address,
): Promise<bigint | undefined> {
  const availability = await probeGateway(key);
  if (!availability.supported || !availability.wallet) return undefined;

  const chain = SUPPORTED_CHAINS[key];
  const token = chain.tokens.USDC?.address;
  if (!token) return undefined;

  try {
    return await clientFor(key).readContract({
      address: availability.wallet,
      abi: gatewayWalletAbi,
      functionName: "availableBalance",
      args: [token, depositor],
    }) as bigint;
  } catch {
    // An ABI drift in Circle's contract must not be reported as a zero balance.
    return undefined;
  }
}

export function gatewayEnabled(): boolean {
  const raw = process.env.GATEWAY_ENABLED;
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Chains where the project could use Gateway, in preference order. */
export function gatewayChains(): SupportedChainKey[] {
  return (Object.keys(GATEWAY_CONTRACTS) as SupportedChainKey[]).filter((key) => Boolean(chainById(SUPPORTED_CHAINS[key].chainId)));
}
