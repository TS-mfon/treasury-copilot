import { decodeDelegations } from "@metamask/delegation-core";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { redelegatePermissionContextAction } from "@metamask/smart-accounts-kit/actions";
import { createWalletClient, encodeFunctionData, http, isAddress, isHex, numberToHex, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, base, baseSepolia } from "viem/chains";

const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export interface OneShotRelayRequest {
  policy: Address;
  method_id?: string;
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
  fee_amount_units?: string;
}

function oneShotRpcUrl() {
  return process.env.ONE_SHOT_RELAYER_URL
    ?? process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
    ?? "https://relayer.1shotapi.dev/relayers";
}

function platformPrivateKey() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("Platform signer is not configured");
  return key.startsWith("0x") ? key as Hex : `0x${key}` as Hex;
}

function viemChain(chainId: string) {
  if (chainId === String(baseSepolia.id)) return baseSepolia;
  if (chainId === String(base.id)) return base;
  if (chainId === String(arbitrumSepolia.id)) return arbitrumSepolia;
  throw new Error(`unsupported delegated execution chain ${chainId}`);
}

function isXLayerChain(chainId: string) {
  const id = Number(chainId);
  return id === 196 || id === 195 || id === 194;
}

async function requireChainCapability(chainId: string) {
  const capabilities = await getCapabilities(chainId).catch((error) => {
    throw new Error(`1Shot capability check failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const capabilityValue = capabilities[chainId];
  if (!capabilityValue || typeof capabilityValue !== "object") {
    throw new Error("1Shot execution is unsupported on this network");
  }
  if (isXLayerChain(chainId) && !isNativeMessageSupported(capabilityValue)) {
    throw new Error("1Shot does not support native OKB on X Layer yet");
  }
  return capabilityValue as Record<string, unknown>;
}

function isNativeMessageSupported(capabilities: unknown) {
  if (!capabilities || typeof capabilities !== "object") return false;
  const record = capabilities as Record<string, unknown>;
  const messages = record.messages as Record<string, unknown> | undefined;
  if (!messages) return false;
  const native = messages.native as Record<string, unknown> | undefined;
  return Boolean(native && Object.keys(native).length > 0);
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

async function getCapabilities(chainId: string) {
  return await rpcCall<Record<string, unknown>>("relayer_getCapabilities", [chainId]);
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
  const firstContext = (values[0] as Record<string, unknown> | undefined)?.context
    ?? (values[0] as Record<string, unknown> | undefined)?.permissionContext;
  if (typeof firstContext === "string" && isHex(firstContext, { strict: true })) {
    try {
      const decoded = decodeDelegations(firstContext);
      if (decoded.length > 0) return decoded.map(formatDelegation);
    } catch {
      // Fall through to per-item formatting below.
    }
  }
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

  return decoded.map(formatDelegation);
}

function formatDelegation(item: unknown) {
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

  const [capability, feeData] = await Promise.all([
    requireChainCapability(body.chain_id),
    rpcCall<{ feeCollector?: Address; targetAddress?: Address }>("relayer_getFeeData", {
      chainId: body.chain_id,
      token: body.token,
    }),
  ]);
  const relayerTarget = feeData.targetAddress
    ?? (capability.targetAddress as Address | undefined)
    ?? (capability.relayerTargetAddress as Address | undefined);
  if (!relayerTarget || !isAddress(relayerTarget)) throw new Error("1Shot capabilities missing relayer target address");
  const feeCollector = feeData.feeCollector;
  if (!feeCollector || !isAddress(feeCollector)) throw new Error("1Shot fee data missing fee collector");

  const account = privateKeyToAccount(platformPrivateKey());
  const walletClient = createWalletClient({
    account,
    chain: viemChain(body.chain_id),
    transport: http(),
  });
  const environment = getSmartAccountsEnvironment(Number(body.chain_id));
  const parentDelegation = Array.isArray(body.delegation_payload)
    ? body.delegation_payload[0] as Record<string, unknown>
    : body.delegation_payload as Record<string, unknown>;
  const parentContext = body.permission_context
    ?? (typeof parentDelegation?.context === "string" ? parentDelegation.context as Hex : undefined)
    ?? (typeof parentDelegation?.permissionContext === "string" ? parentDelegation.permissionContext as Hex : undefined);
  if (!parentContext || !isHex(parentContext, { strict: true })) throw new Error("missing valid parent permission context for 1Shot redelegation");
  const redelegateResult = await redelegatePermissionContextAction(walletClient, {
    account,
    permissionContext: parentContext,
    to: relayerTarget,
    environment,
    chainId: Number(body.chain_id),
  });
  const redelegatedObj = {
    ...(redelegateResult.delegation as Record<string, unknown>),
    context: redelegateResult.permissionContext,
  };

  const delegationChain = formatDelegationChain([redelegatedObj, parentDelegation]);
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

  const buildPayload = (executions: typeof workTx[]) => ({
    chainId: body.chain_id,
    transactions: [{
      permissionContext: delegationChain,
      executions: executions.map((tx) => ({ target: tx.to, value: tx.value, data: tx.data })),
    }],
    authorizationList: [],
  });

  const initialEstimate = await rpcCall<{ requiredPaymentAmount?: string }>(
    "relayer_estimate7710Transaction",
    buildPayload([dummyFeeTx, workTx]),
  );
  if (!initialEstimate.requiredPaymentAmount) throw new Error("1Shot estimate missing required payment amount");

  const feeTx = {
    to: body.token,
    data: encodeErc20Transfer(feeCollector, BigInt(initialEstimate.requiredPaymentAmount)),
    value: "0x0",
  };
  const finalPayload = buildPayload([feeTx, workTx]);
  const finalEstimate = await rpcCall<{ context?: string }>("relayer_estimate7710Transaction", finalPayload);
  if (!finalEstimate.context) throw new Error("1Shot final estimate missing context");

  const sendResult = await rpcCall<string | { taskId?: string; result?: string; id?: string }>("relayer_send7710Transaction", {
    ...finalPayload,
    context: finalEstimate.context,
  });
  const taskId = typeof sendResult === "string" ? sendResult : (sendResult.taskId ?? sendResult.result ?? sendResult.id);
  if (!taskId) throw new Error(`1Shot send response missing task id: ${JSON.stringify(sendResult).slice(0, 240)}`);
  const txHash = await pollStatus(taskId);
  return {
    tx_hash: txHash,
    raw: { taskId, relayerTarget, feeCollector, sendResult },
    mode: "erc7710",
    task_id: taskId,
    fee_amount_units: initialEstimate.requiredPaymentAmount,
  };
}

export async function executeOneShot(body: OneShotRelayRequest): Promise<OneShotExecutionResult> {
  if (body.delegation_payload) return execute7710(body);
  return directPost(body);
}
