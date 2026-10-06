import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentTreasuryAbi, chainById, type ChainConfig } from "@treasury-copilot/shared";

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
}

export interface ArcVaultExecutionResult {
  tx_hash: Hex;
  raw: unknown;
  mode: "arc-vault";
}

function arcChainConfig(chainId: number): ChainConfig {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  if (chain.executionBackend !== "arc-vault") {
    throw new Error(`${chain.name} does not settle through an agent treasury vault`);
  }
  return chain;
}

export function arcExecutorAccount() {
  const key = process.env.ARC_EXECUTOR_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Arc executor is not configured");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Arc executor private key must be exactly 32 bytes of hex");
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
  if (chain.chainId === 5042002) {
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
export async function preflightArcVaultPayout(request: ArcVaultPayoutRequest) {
  const chain = arcChainConfig(request.chainId);
  const client = arcPublicClient(request.chainId);
  const account = arcExecutorAccount();
  const at = { address: request.vault, abi: agentTreasuryAbi } as const;

  const [executed, executor, paused, availableBalance, gas] = await Promise.all([
    client.readContract({ ...at, functionName: "executed", args: [request.requestId] }) as Promise<boolean>,
    client.readContract({ ...at, functionName: "executor" }) as Promise<Address>,
    client.readContract({ ...at, functionName: "paused" }) as Promise<boolean>,
    client.readContract({ ...at, functionName: "availableBalance" }) as Promise<bigint>,
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
  // Arc charges gas in native USDC, so an unfunded executor stalls settlement silently.
  if (gas === 0n) throw new Error(`Arc executor ${account.address} has no ${chain.nativeSymbol} for gas`);

  return { account, client, chain, amount };
}

export async function executeArcVaultPayout(request: ArcVaultPayoutRequest): Promise<ArcVaultExecutionResult> {
  if (!isAddress(request.vault)) throw new Error("Arc vault address is invalid");
  if (!isAddress(request.recipient)) throw new Error("Arc recipient address is invalid");

  const { account, client, chain, amount } = await preflightArcVaultPayout(request);

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

  const hash = await wallet.writeContract({
    chain: chain.viemChain,
    address: request.vault,
    abi: agentTreasuryAbi,
    functionName: "payout",
    args: [request.requestId, request.recipient, amount],
    ...(maxFeePerGas > 0n ? { maxFeePerGas, maxPriorityFeePerGas } : {}),
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Arc payout transaction ${hash} reverted`);
  }

  return {
    tx_hash: hash,
    raw: {
      chainId: chain.chainId,
      vault: request.vault,
      executor: account.address,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    },
    mode: "arc-vault",
  };
}
