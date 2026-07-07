import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Address, Hex } from "viem";

type GenLayerServerClient = ReturnType<typeof createClient>;
type GenLayerAccount = ReturnType<typeof createAccount>;
type GenLayerHash = Hex & { length: 66 };

function privateKey() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("Platform signer is not configured");
  return key.startsWith("0x") ? key as Hex : `0x${key}` as Hex;
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

export async function genlayerRead<T>(address: Address, functionName: string, args: unknown[] = []) {
  return await client().readContract({
    address,
    functionName,
    args: args as never[],
    jsonSafeReturn: true,
  }) as T;
}

export async function genlayerWrite(address: Address, functionName: string, args: unknown[] = []) {
  const hash = await client().writeContract({
    account: account(),
    address,
    functionName,
    args: args as never[],
    value: 0n,
  }) as Hex;
  const receipt = await client().waitForTransactionReceipt({
    hash: hash as GenLayerHash,
    status: TransactionStatus.ACCEPTED,
    retries: 80,
    interval: 3000,
  });
  const rawReceipt = receipt as Record<string, unknown>;
  const resultName = String(rawReceipt.resultName ?? rawReceipt.result_name ?? "");
  const statusName = String(rawReceipt.statusName ?? rawReceipt.status_name ?? "");
  if (statusName === "UNDETERMINED" || resultName === "UNDETERMINED") {
    throw new Error(`${functionName} hit UNDETERMINED`);
  }
  const executionResult = String(rawReceipt.txExecutionResultName ?? rawReceipt.execution_result ?? "");
  if (executionResult.includes("ERROR")) {
    throw new Error(`${functionName} failed on GenLayer: ${JSON.stringify(receipt).slice(0, 400)}`);
  }
  return { hash, receipt };
}
