import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import type { Address, Hex } from "viem";
import { canonicalGenLayerAddress } from "@/lib/genlayerAddress";
import { errorMessage } from "@/lib/errors";

type GenLayerServerClient = ReturnType<typeof createClient>;
type GenLayerAccount = ReturnType<typeof createAccount>;
type GenLayerHash = Hex & { length: 66 };

function privateKey() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Platform signer is not configured");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Platform signer private key must be exactly 32 bytes of hex");
  }
  return normalized as Hex;
}

let cachedAccount: GenLayerAccount | undefined;
let cachedClient: GenLayerServerClient | undefined;

function account() {
  cachedAccount ??= createAccount(privateKey());
  return cachedAccount;
}

function client() {
  cachedClient ??= createClient({
    chain: studionet,
    account: account(),
  });
  return cachedClient;
}

export function assertGenLayerExecutionSucceeded(
  receipt: Record<string, unknown>,
  operation: string,
) {
  const consensusResult = String(
    receipt.resultName
    ?? receipt.result_name
    ?? "",
  ).toUpperCase();
  if (
    consensusResult.includes("MAJORITY_DISAGREE")
    || consensusResult.includes("UNDETERMINED")
  ) {
    throw new Error(`${operation} failed on GenLayer: ${consensusResult}`);
  }

  const directExecution = String(
    receipt.txExecutionResultName
    ?? receipt.tx_execution_result_name
    ?? receipt.executionResult
    ?? receipt.execution_result
    ?? "",
  ).toUpperCase();
  if (directExecution.includes("ERROR") || directExecution.includes("FINISHED_WITH_ERROR")) {
    throw new Error(`${operation} failed on GenLayer: ${directExecution}`);
  }

  const consensus = (receipt.consensus_data ?? receipt.consensusData) as Record<string, unknown> | undefined;
  const leaderReceipts = consensus?.leader_receipt ?? consensus?.leaderReceipt;
  if (!Array.isArray(leaderReceipts)) return;

  for (const rawLeaderReceipt of leaderReceipts) {
    if (!rawLeaderReceipt || typeof rawLeaderReceipt !== "object") continue;
    const leaderReceipt = rawLeaderReceipt as Record<string, unknown>;
    const mode = String(leaderReceipt.mode ?? "").toLowerCase();
    const execution = String(
      leaderReceipt.execution_result
      ?? leaderReceipt.executionResult
      ?? "",
    ).toUpperCase();
    const result = leaderReceipt.result as Record<string, unknown> | undefined;
    const resultStatus = String(result?.status ?? "").toLowerCase();
    const genvmResult = leaderReceipt.genvm_result as Record<string, unknown> | undefined;
    const quorumCancelled = String(genvmResult?.error_code ?? "") === "CONSENSUS_VALIDATOR_QUORUM_REACHED";
    if (
      mode === "leader"
      && !quorumCancelled
      && (
        execution.includes("ERROR")
        || execution.includes("FINISHED_WITH_ERROR")
        || resultStatus === "contract_error"
      )
    ) {
      const stderr = typeof genvmResult?.stderr === "string"
        ? genvmResult.stderr.trim().split("\n").slice(-4).join(" ")
        : "";
      const payload = typeof result?.payload === "string" ? result.payload.trim() : "";
      const detail = payload || stderr;
      throw new Error(`${operation} failed on GenLayer${detail ? `: ${detail}` : ""}`);
    }
  }
}

export async function genlayerRead<T>(
  address: Address,
  functionName: string,
  args: unknown[] = [],
  state: "latest" | "finalized" = "latest",
) {
  return await client().readContract({
    address: canonicalGenLayerAddress(address),
    functionName,
    args: args as never[],
    jsonSafeReturn: true,
    transactionHashVariant: state === "finalized"
      ? TransactionHashVariant.LATEST_FINAL
      : TransactionHashVariant.LATEST_NONFINAL,
  }) as T;
}

export async function genlayerSubmitWrite(
  address: Address,
  functionName: string,
  args: unknown[] = [],
) {
  try {
    return await client().writeContract({
      account: account(),
      address: canonicalGenLayerAddress(address),
      functionName,
      args: args as never[],
      value: 0n,
    }) as Hex;
  } catch (error) {
    throw new Error(`${functionName} submission failed on GenLayer: ${errorMessage(error)}`);
  }
}

export async function genlayerWrite(
  address: Address,
  functionName: string,
  args: unknown[] = [],
  finality: "decided" | "finalized" = "finalized",
) {
  let hash: Hex;
  try {
    hash = await client().writeContract({
      account: account(),
      address: canonicalGenLayerAddress(address),
      functionName,
      args: args as never[],
      value: 0n,
    }) as Hex;
  } catch (error) {
    throw new Error(`${functionName} submission failed on GenLayer: ${errorMessage(error)}`);
  }
  let receipt;
  try {
    receipt = await client().waitForTransactionReceipt({
      hash: hash as GenLayerHash,
      status: finality === "finalized" ? TransactionStatus.FINALIZED : TransactionStatus.ACCEPTED,
      retries: 80,
      interval: 3000,
    });
  } catch (error) {
    throw new Error(
      `${functionName} transaction ${hash} failed while waiting for GenLayer ${finality}: ${errorMessage(error)}`,
    );
  }
  const rawReceipt = receipt as Record<string, unknown>;
  assertGenLayerExecutionSucceeded(rawReceipt, functionName);
  const resultName = String(rawReceipt.resultName ?? rawReceipt.result_name ?? "");
  const statusName = String(rawReceipt.statusName ?? rawReceipt.status_name ?? "");
  if (
    statusName === "UNDETERMINED"
    || resultName === "UNDETERMINED"
    || resultName === "MAJORITY_DISAGREE"
  ) {
    throw new Error(`${functionName} failed consensus: ${resultName || statusName}`);
  }
  const executionResult = String(rawReceipt.txExecutionResultName ?? rawReceipt.execution_result ?? "");
  if (executionResult.includes("ERROR")) {
    throw new Error(`${functionName} failed on GenLayer: ${JSON.stringify(receipt).slice(0, 400)}`);
  }
  return { hash, receipt };
}

function deployedAddress(receipt: Record<string, unknown>): Address {
  const data = receipt.data as Record<string, unknown> | undefined;
  const decoded = receipt.txDataDecoded as Record<string, unknown> | undefined;
  const value = data?.contract_address
    ?? data?.contractAddress
    ?? decoded?.contract_address
    ?? decoded?.contractAddress;
  if (typeof value !== "string") throw new Error("GenLayer deployment receipt did not include a contract address");
  return value as Address;
}

async function contractSource(filename: string) {
  const candidates = [
    path.resolve(process.cwd(), "contracts/genlayer", filename),
    path.resolve(process.cwd(), "../../contracts/genlayer", filename),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load ${filename}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function deployTreasuryPolicy(args: unknown[]) {
  const hash = await client().deployContract({
    account: account(),
    code: await contractSource("TreasuryPolicy.py"),
    args: args as never[],
  }) as Hex;
  const receipt = await client().waitForTransactionReceipt({
    hash: hash as GenLayerHash,
    status: TransactionStatus.FINALIZED,
    retries: 120,
    interval: 3000,
  }) as Record<string, unknown>;
  assertGenLayerExecutionSucceeded(receipt, "Treasury policy deployment");
  return { hash, receipt, address: deployedAddress(receipt) };
}
