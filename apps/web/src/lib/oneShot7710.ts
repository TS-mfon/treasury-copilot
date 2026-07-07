import { decodeDelegations } from "@metamask/delegation-core";
import { encodeFunctionData, isAddress, isHex, numberToHex, parseAbi, type Address, type Hex } from "viem";

const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export interface OneShotRelayRequest {
  policy: Address;
  method_id: string;
  chain_id: string;
  delegated_account?: Address;
  token?: Address;
  delegation?: string;
  permission_context?: Hex;
  delegation_payload?: unknown;
  params: {
    requestId: Hex;
    from?: Address;
    token?: Address;
    recipient: Address;
    amount: string;
  };
}

export interface OneShotExecutionResult {
  tx_hash: Hex;
  raw: unknown;
  mode: "erc7710" | "direct";
  task_id?: string;
}

function oneShotRpcUrl() {
  return process.env.ONE_SHOT_RELAYER_URL
    ?? process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
    ?? "https://relayer.1shotapi.dev/relayers";
}

async function rpcCall<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(oneShotRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  const data = await response.json().catch(async () => ({ error: { message: await response.text() } })) as {
    error?: { message?: string; data?: unknown };
    result?: T;
  };
  if (!response.ok || data.error) {
    throw new Error(`${method} failed: ${data.error?.message ?? response.statusText}${data.error?.data ? ` ${JSON.stringify(data.error.data).slice(0, 240)}` : ""}`);
  }
  return data.result as T;
}

function formatDelegationChain(delegationPayload: unknown): unknown[] {
  if (typeof delegationPayload === "string") {
    try {
      delegationPayload = JSON.parse(delegationPayload);
    } catch {
      throw new Error("delegation payload is not valid JSON");
    }
  }
  const values = Array.isArray(delegationPayload) ? delegationPayload : [delegationPayload];
  const decoded: unknown[] = [];

  for (const item of values) {
    const record = item as Record<string, unknown>;
    const context = record?.context ?? record?.permissionContext;
    if (typeof context === "string" && isHex(context, { strict: true })) {
      try {
        decoded.push(...decodeDelegations(context));
        continue;
      } catch {
        // Fall through to object formatting below.
      }
    }
    decoded.push(item);
  }

  return decoded.map((item) => {
    const record = item as Record<string, unknown>;
    let salt = record.salt;
    if (typeof salt === "bigint") salt = numberToHex(salt, { size: 32 });
    if (typeof salt === "string" && /^[0-9]+$/.test(salt)) salt = numberToHex(BigInt(salt), { size: 32 });
    if (!salt) salt = "0x0000000000000000000000000000000000000000000000000000000000000000";

    return {
      ...record,
      delegate: record.delegate ?? record.to ?? "",
      delegator: record.delegator ?? record.from ?? "",
      authority: record.authority ?? "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: record.caveats ?? [],
      salt,
      signature: record.signature ?? "",
    };
  });
}

function encodeErc20Transfer(recipient: Address, amount: bigint) {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amount],
  });
}

async function directPost(body: OneShotRelayRequest): Promise<OneShotExecutionResult> {
  const response = await fetch(oneShotRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(async () => ({ raw: await response.text() })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`1Shot relayer failed: ${response.status} ${JSON.stringify(data).slice(0, 240)}`);
  }

  const txHash = String(data.tx_hash ?? data.txHash ?? data.hash ?? "");
  if (!isHex(txHash, { strict: true })) {
    throw new Error(`1Shot relayer response missing tx hash: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return { tx_hash: txHash, raw: data, mode: "direct" };
}

async function pollStatus(taskId: string): Promise<Hex> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const status = await rpcCall<Record<string, unknown>>("relayer_getStatus", { id: taskId, logs: false });
    const rawStatus = String(status.status ?? "");
    const txHash = String((status.receipt as Record<string, unknown> | undefined)?.transactionHash ?? status.hash ?? status.txHash ?? status.transactionHash ?? "");
    if ((rawStatus === "200" || rawStatus.toLowerCase() === "confirmed") && isHex(txHash, { strict: true })) return txHash;
    if (["400", "500", "failed", "rejected", "reverted"].includes(rawStatus.toLowerCase())) {
      throw new Error(`1Shot task failed: ${JSON.stringify(status).slice(0, 240)}`);
    }
  }
  throw new Error("1Shot task timed out before confirmation");
}

async function execute7710(body: OneShotRelayRequest): Promise<OneShotExecutionResult> {
  if (!body.token || !isAddress(body.token)) throw new Error("missing token for 7710 execution");
  if (!body.delegation_payload) throw new Error("missing delegation payload for 7710 execution");
  const delegatedAccount = body.delegated_account ?? body.params.from;
  if (!delegatedAccount || !isAddress(delegatedAccount)) throw new Error("missing delegated account for 7710 execution");

  const feeData = await rpcCall<{ feeCollector?: Address; targetAddress?: Address }>("relayer_getFeeData", {
    chainId: body.chain_id,
    token: body.token,
  });
  const feeCollector = feeData.feeCollector;
  if (!feeCollector || !isAddress(feeCollector)) throw new Error("1Shot fee data missing fee collector");

  const delegationChain = formatDelegationChain(body.delegation_payload);
  const workTx = {
    to: body.token,
    data: encodeErc20Transfer(body.params.recipient, BigInt(body.params.amount)),
    value: "0x0",
  };
  const dummyFeeTx = {
    to: body.token,
    data: encodeErc20Transfer(feeCollector, 1_000_000n),
    value: "0x0",
  };

  const estimatePayload = {
    chainId: body.chain_id,
    transactions: [{
      permissionContext: delegationChain,
      executions: [dummyFeeTx, workTx].map((tx) => ({ target: tx.to, value: tx.value, data: tx.data })),
    }],
    authorizationList: [],
  };
  const initialEstimate = await rpcCall<{ requiredPaymentAmount?: string }>("relayer_estimate7710Transaction", estimatePayload);
  if (!initialEstimate.requiredPaymentAmount) throw new Error("1Shot estimate missing required payment amount");

  const feeTx = {
    to: body.token,
    data: encodeErc20Transfer(feeCollector, BigInt(initialEstimate.requiredPaymentAmount)),
    value: "0x0",
  };
  const finalPayload = {
    chainId: body.chain_id,
    transactions: [{
      permissionContext: delegationChain,
      executions: [feeTx, workTx].map((tx) => ({ target: tx.to, value: tx.value, data: tx.data })),
    }],
    authorizationList: [],
  };
  const finalEstimate = await rpcCall<{ context?: string }>("relayer_estimate7710Transaction", finalPayload);
  if (!finalEstimate.context) throw new Error("1Shot final estimate missing context");

  const sendResult = await rpcCall<string | { taskId?: string; result?: string; id?: string }>("relayer_send7710Transaction", {
    ...finalPayload,
    context: finalEstimate.context,
  });
  const taskId = typeof sendResult === "string" ? sendResult : (sendResult.taskId ?? sendResult.result ?? sendResult.id);
  if (!taskId) throw new Error(`1Shot send response missing task id: ${JSON.stringify(sendResult).slice(0, 240)}`);
  const txHash = await pollStatus(taskId);
  return { tx_hash: txHash, raw: sendResult, mode: "erc7710", task_id: taskId };
}

export async function executeOneShot(body: OneShotRelayRequest): Promise<OneShotExecutionResult> {
  if (body.delegation_payload) return execute7710(body);
  return directPost(body);
}
