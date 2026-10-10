import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentTreasuryAbi, chainById, type ChainConfig } from "@treasury-copilot/shared";
import {
  CctpUnsupportedError,
  FORWARDING_HOOK_DATA,
  quoteFee,
  resolveRoute,
  type CctpFeeQuote,
  type CctpRoute,
} from "@/lib/cctp";

/**
 * Server-side Arc settlement.
 *
 * Base and Arbitrum settle by redelegating the owner's ERC-7715 MetaMask permission to the
 * 1Shot relayer (`oneShot7710.ts`). Arc supports neither the MetaMask Delegation Framework nor
 * 1Shot, so an approved Arc payment is executed by calling `payout` on the owner's AgentTreasury
 * vault with a dedicated Arc executor key. The owner keeps withdraw and pause authority; this
 * key can only move money for a request GenLayer already approved.
 */

export interface ArcVaultPayoutRequest {
  chainId: number;
  vault: Address;
  requestId: Hex;
  recipient: Address;
  /** Amount in token base units (USDC uses 6 decimals on Arc's ERC-20 interface). */
  amount: string;
  /** Chain the payee receives on. Defaults to the vault's own chain. */
  destinationChainId?: number;
}

export interface ArcVaultExecutionResult {
  tx_hash: Hex;
  raw: unknown;
  mode: "arc-vault";
  /** "direct" settles on the vault's chain; "cctp" burns for delivery on another chain. */
  route: "direct" | "cctp";
  /** Present for a cctp route: the burn transaction is not yet the payee's receipt. */
  bridge?: { route: CctpRoute; quote: CctpFeeQuote; burnTxHash: Hex };
}

function arcChainConfig(chainId: number): ChainConfig {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  if (chain.executionBackend !== "arc-vault") {
    throw new Error(`${chain.name} does not settle through an agent treasury vault`);
  }
  return chain;
}

/** Arc Mainnet. Named so the chain-id checks below read as intent rather than a magic number. */
export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * The executor key for an Arc chain.
 *
 * Mainnet reads `ARC_MAINNET_EXECUTOR_PRIVATE_KEY` and **never falls back** to the testnet
 * variable. The fallback is the dangerous part, not the duplication: a deployment that already
 * has `ARC_EXECUTOR_PRIVATE_KEY` set for testnet would otherwise start signing real-USDC
 * mainnet payouts with a key that was provisioned, funded and handled as a testnet key, and
 * nothing in the logs would say so. Requiring a separate variable makes reusing one key a
 * decision someone has to write down (by setting both to the same value) rather than an accident.
 */
function executorKeyVariable(chainId: number): "ARC_MAINNET_EXECUTOR_PRIVATE_KEY" | "ARC_EXECUTOR_PRIVATE_KEY" {
  return chainId === ARC_MAINNET_CHAIN_ID
    ? "ARC_MAINNET_EXECUTOR_PRIVATE_KEY"
    : "ARC_EXECUTOR_PRIVATE_KEY";
}

export function arcExecutorAccount(chainId: number = ARC_TESTNET_CHAIN_ID) {
  const variable = executorKeyVariable(chainId);
  const key = process.env[variable]?.trim();
  if (!key) throw new Error(`Arc executor is not configured: set ${variable}`);
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${variable} must be exactly 32 bytes of hex`);
  }
  const account = privateKeyToAccount(normalized as Hex);
  if (account.address.toLowerCase() === platformSignerAddress()?.toLowerCase()) {
    throw new Error("Arc executor key must differ from the platform signer key");
  }
  return account;
}

function platformSignerAddress(): string | undefined {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY?.trim();
  if (!key) return undefined;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return undefined;
  return privateKeyToAccount(normalized as Hex).address;
}

function rpcUrlFor(chain: ChainConfig) {
  if (chain.chainId === ARC_TESTNET_CHAIN_ID) {
    return process.env.ARC_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL;
  }
  return process.env.ARC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
}

export function arcPublicClient(chainId: number) {
  const chain = arcChainConfig(chainId);
  return createPublicClient({ chain: chain.viemChain, transport: http(rpcUrlFor(chain)) });
}

/**
 * Reject a payout before spending gas when the vault cannot honour it.
 *
 * `executed` is checked first because it is the one condition that is permanent: a replayed
 * request must be reported as already settled rather than retried forever by the cron worker.
 */
export async function preflightArcVaultPayout(request: ArcVaultPayoutRequest, maxFee = 0n) {
  const chain = arcChainConfig(request.chainId);
  const client = arcPublicClient(request.chainId);
  const account = arcExecutorAccount(request.chainId);
  const at = { address: request.vault, abi: agentTreasuryAbi } as const;

  const [executed, executor, paused, availableBalance, feeReserve, gas] = await Promise.all([
    client.readContract({ ...at, functionName: "executed", args: [request.requestId] }) as Promise<boolean>,
    client.readContract({ ...at, functionName: "executor" }) as Promise<Address>,
    client.readContract({ ...at, functionName: "paused" }) as Promise<boolean>,
    client.readContract({ ...at, functionName: "availableBalance" }) as Promise<bigint>,
    client.readContract({ ...at, functionName: "feeReserve" }) as Promise<bigint>,
    client.getBalance({ address: account.address }),
  ]);

  if (executed) throw new Error(`Arc vault already settled request ${request.requestId}`);
  if (executor.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Arc vault executor is ${executor}, which is not the configured Arc executor`);
  }
  if (paused) throw new Error("Arc vault is paused by its owner");

  const amount = BigInt(request.amount);
  if (amount <= 0n) throw new Error("Arc payout amount must be greater than zero");
  if (availableBalance < amount) {
    throw new Error(`Arc vault has ${availableBalance} available but the request needs ${amount}`);
  }
  // The CCTP fee is drawn from the bounded reserve, never from the approved principal.
  if (maxFee > 0n && feeReserve < maxFee) {
    throw new Error(`Arc vault fee reserve is ${feeReserve} but the CCTP fee needs ${maxFee}`);
  }
  // Arc charges gas in native USDC, so an unfunded executor stalls settlement silently.
  if (gas === 0n) throw new Error(`Arc executor ${account.address} has no ${chain.nativeSymbol} for gas`);

  return { account, client, chain, amount, feeReserve };
}

export interface VaultPayoutPlan {
  functionName: "payout" | "payoutCrossChain";
  args: readonly unknown[];
  route: "direct" | "cctp";
}

/**
 * Decide which vault call settles a request.
 *
 * Pure so the routing choice can be proven without a wallet: a same-chain request must use
 * `payout`, and a cross-chain request must burn principal plus the quoted fee so CCTP's deduction
 * still leaves the payee whole.
 */
export function planVaultPayout(
  request: ArcVaultPayoutRequest,
  route?: CctpRoute,
  quote?: CctpFeeQuote,
): VaultPayoutPlan {
  const destinationChainId = request.destinationChainId ?? request.chainId;
  const amount = BigInt(request.amount);

  if (destinationChainId === request.chainId) {
    return {
      functionName: "payout",
      args: [request.requestId, request.recipient, amount],
      route: "direct",
    };
  }
  if (!route || !quote) {
    throw new Error("A cross-chain payout needs a resolved CCTP route and fee quote");
  }
  return {
    functionName: "payoutCrossChain",
    args: [
      request.requestId,
      request.recipient,
      amount,
      route.destinationDomain,
      quote.maxFee,
      quote.minFinalityThreshold,
      // Hook data routes the mint through Circle's Forwarding Service, so no executor or gas
      // balance is needed on the destination chain.
      quote.forwarded ? FORWARDING_HOOK_DATA : "0x",
    ],
    route: "cctp",
  };
}

export async function executeArcVaultPayout(request: ArcVaultPayoutRequest): Promise<ArcVaultExecutionResult> {
  if (!isAddress(request.vault)) throw new Error("Arc vault address is invalid");
  if (!isAddress(request.recipient)) throw new Error("Arc recipient address is invalid");

  const destinationChainId = request.destinationChainId ?? request.chainId;
  const crossChain = destinationChainId !== request.chainId;

  // Quote before preflight so the reserve check knows the real fee. A quote failure must abort
  // rather than silently degrade into a same-chain payout to the wrong network.
  let route: CctpRoute | undefined;
  let quote: CctpFeeQuote | undefined;
  if (crossChain) {
    try {
      route = resolveRoute(request.chainId, destinationChainId);
      quote = await quoteFee(route, { forwarded: true });
    } catch (error) {
      if (error instanceof CctpUnsupportedError) {
        throw new Error(`Cross-chain settlement unavailable at the ${error.stage} stage: ${error.message}`);
      }
      throw error;
    }
  }

  // planVaultPayout derives the amount itself, so only the clients and chain are needed here.
  const { account, client, chain } = await preflightArcVaultPayout(request, quote?.maxFee ?? 0n);

  const wallet = createWalletClient({
    account,
    chain: chain.viemChain,
    transport: http(rpcUrlFor(chain)),
  });

  // Arc's mempool rejects anything under a 20 gwei maxFeePerGas, and an estimator that returns
  // less would produce a transaction the node silently refuses.
  const fees = await client.estimateFeesPerGas().catch(() => undefined);
  const floor = chain.minMaxFeePerGas ?? 0n;
  const maxFeePerGas = fees?.maxFeePerGas && fees.maxFeePerGas > floor ? fees.maxFeePerGas : floor;
  const maxPriorityFeePerGas = fees?.maxPriorityFeePerGas ?? 0n;
  const gasOverrides = maxFeePerGas > 0n ? { maxFeePerGas, maxPriorityFeePerGas } : {};

  const plan = planVaultPayout(request, route, quote);
  const hash = await wallet.writeContract({
    chain: chain.viemChain,
    address: request.vault,
    abi: agentTreasuryAbi,
    functionName: plan.functionName,
    // The plan is built from the same request and quote the preflight validated.
    args: plan.args as never,
    ...gasOverrides,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Arc ${crossChain ? "cross-chain burn" : "payout"} transaction ${hash} reverted`);
  }

  return {
    tx_hash: hash,
    raw: {
      chainId: chain.chainId,
      destinationChainId,
      vault: request.vault,
      executor: account.address,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      ...(quote ? { maxFee: quote.maxFee.toString(), forwarded: quote.forwarded } : {}),
    },
    mode: "arc-vault",
    route: crossChain ? "cctp" : "direct",
    ...(crossChain && route && quote ? { bridge: { route, quote, burnTxHash: hash } } : {}),
  };
}
