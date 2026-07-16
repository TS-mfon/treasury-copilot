import { formatUnits, isAddress, keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTreasuryRequestDomain, treasuryRequestTypes, type TreasuryRequestMessage } from "@treasury-copilot/shared";
import type { AgentApiKeyClaims } from "@/lib/apiAuth";
import { genlayerRead, genlayerWrite } from "@/lib/genlayerServer";
import { executeOneShot, type OneShotRelayRequest } from "@/lib/oneShot7710";
import { parseAmount } from "@/lib/amounts";

export interface SpendPayload {
  agent: Address;
  recipient: Address;
  amount: string;
  category: string;
  justification: string;
  requestId?: Hex;
}

export interface PolicyState {
  owner?: string;
  authorized_agent?: string;
  execution_reporter?: string;
  delegated_account?: string;
  token_address?: string;
  delegation_context?: string;
  delegation_registered?: boolean;
  delegation_payload?: unknown;
  evm_chain_id?: string;
  per_tx_cap_atto?: string;
  weekly_cap_atto?: string;
  auto_approve_threshold_atto?: string;
  weekly_spent_atto?: string;
  policy_text?: string;
}

export interface RegistryBinding {
  owner: string;
  agent: string;
  policy: string;
  chain_id: string;
  delegated_account: string;
  token_address: string;
  token_symbol: string;
  token_decimals: string;
  active: boolean;
  api_key_version?: string;
}

export interface RequestState {
  request_id: string;
  recipient: string;
  amount_atto: string;
  category: string;
  justification: string;
  verdict: string;
  reasoning: string;
  tx_hash: string;
  created_at: string;
  execution_status?: string;
  execution_error?: string;
}

export function platformAccount() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("Platform signer is not configured");
  return privateKeyToAccount(key.startsWith("0x") ? key as Hex : `0x${key}` as Hex);
}

export function parseSpendPayload(value: unknown): SpendPayload {
  if (!value || typeof value !== "object") throw new Error("Invalid spend payload");
  const body = value as Record<string, unknown>;
  const recipient = body.recipient;
  const amount = body.amount ?? body.amount_usdc;
  const category = body.category;
  const justification = body.justification;
  const agent = body.agent ?? body.agent_address;
  const requestId = body.request_id ?? body.requestId;

  if (typeof agent !== "string" || !isAddress(agent)) throw new Error("agent_address is required and must be a valid address");
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new Error("Invalid recipient");
  if (typeof amount !== "string" || amount.trim() === "") throw new Error("Invalid amount");
  if (typeof category !== "string" || category.trim().length < 2) throw new Error("Invalid category");
  if (typeof justification !== "string" || justification.trim().length < 4) throw new Error("Add a clearer justification");
  if (requestId !== undefined && (typeof requestId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(requestId))) throw new Error("Invalid request id");

  return {
    agent: agent as Address,
    recipient: recipient as Address,
    amount: amount.trim(),
    category: category.trim(),
    justification: justification.trim(),
    requestId: requestId as Hex | undefined,
  };
}

export function amountToUnits(value: string, decimals: number) {
  return parseAmount(value, decimals);
}

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
}

export function assertPolicyMatchesApiKey(policy: PolicyState, claims: AgentApiKeyClaims) {
  if (lower(policy.authorized_agent) !== claims.agent.toLowerCase()) throw new Error("API key agent is not authorized for this policy");
  if (lower(policy.delegated_account) !== claims.delegatedAccount.toLowerCase()) throw new Error("API key delegated account does not match policy");
  if (lower(policy.token_address) !== claims.token.toLowerCase()) throw new Error("API key token does not match policy");
  if (String(policy.evm_chain_id ?? "") !== String(claims.chainId)) throw new Error("API key chain does not match policy");
  if (!policy.delegation_registered || !policy.delegation_payload) throw new Error("Delegation is not registered for this policy");
}

export async function assertRegistryBinding(claims: AgentApiKeyClaims) {
  const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
  const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [claims.policy]);
  if (!binding.active) throw new Error("This agent policy is inactive");
  if (lower(binding.owner) !== claims.owner.toLowerCase() || lower(binding.agent) !== claims.agent.toLowerCase()) throw new Error("Registry owner or agent does not match API key");
  if (lower(binding.delegated_account) !== claims.delegatedAccount.toLowerCase() || lower(binding.token_address) !== claims.token.toLowerCase()) throw new Error("Registry funding binding does not match API key");
  if (String(binding.chain_id) !== String(claims.chainId)) throw new Error("Registry chain does not match API key");
  if (Number(binding.api_key_version ?? 1) !== claims.keyVersion) throw new Error("API key has been rotated or revoked");
  return binding;
}

export async function readPolicyState(policy: Address) {
  return await genlayerRead<PolicyState>(policy, "get_policy");
}

export async function listPolicyRequests(policy: Address) {
  return await genlayerRead<string[]>(policy, "list_requests");
}

export async function readPolicyRequest(policy: Address, requestId: string) {
  return await genlayerRead<RequestState>(policy, "get_request", [requestId]);
}

export async function submitSpendThroughPolicy(claims: AgentApiKeyClaims, payload: SpendPayload) {
  if (payload.agent.toLowerCase() !== claims.agent.toLowerCase()) {
    throw new Error("Request agent does not match API key");
  }

  const policy = await readPolicyState(claims.policy);
  assertPolicyMatchesApiKey(policy, claims);
  await assertRegistryBinding(claims);

  const account = platformAccount();
  const amountAtto = amountToUnits(payload.amount, claims.tokenDecimals);
  const requestId = payload.requestId
    ?? keccak256(stringToHex(`${claims.policy}:${claims.delegatedAccount}:${payload.recipient}:${amountAtto}:${payload.category}:${payload.justification}:${payload.agent}`));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
  const justificationHash = keccak256(stringToHex(payload.justification));

  const signature = await account.signTypedData({
    domain: buildTreasuryRequestDomain(claims.chainId, claims.policy),
    types: treasuryRequestTypes,
    primaryType: "TreasuryRequest",
    message: {
      policy: claims.policy,
      delegatedAccount: claims.delegatedAccount,
      recipient: payload.recipient,
      amountAtto,
      category: payload.category,
      justificationHash,
      requestId,
      deadline,
    },
  });

  const submit = await genlayerWrite(claims.policy, "submit_request", [
    payload.recipient,
    amountAtto.toString(),
    payload.category,
    payload.justification,
    justificationHash,
    signature,
    requestId,
    deadline.toString(),
    claims.agent,
  ]);
  const requestState = await readPolicyRequest(claims.policy, requestId);

  return { requestId, policy, requestState, submit, execution: null, record: null };
}

export async function executeApprovedPolicyRequest(policyAddress: Address, requestId: Hex) {
  const policy = await readPolicyState(policyAddress);
  if (!policy.delegation_registered || !policy.delegation_payload) throw new Error("Approved request has no active ERC-7715 delegation");
  await genlayerWrite(policyAddress, "claim_execution", [requestId]);
  const relay = {
    policy: policyAddress,
    chain_id: String(policy.evm_chain_id ?? ""),
    delegated_account: String(policy.delegated_account ?? ""),
    token: String(policy.token_address ?? ""),
    delegation: "metamask-smart-account-payout",
    permission_context: String(policy.delegation_context ?? ""),
    delegation_payload: policy.delegation_payload,
    params: {
      requestId,
      from: String(policy.delegated_account ?? ""),
      token: String(policy.token_address ?? ""),
      recipient: "0x0000000000000000000000000000000000000000" as Address,
      amount: "0",
    },
  } as OneShotRelayRequest;
  const request = await readPolicyRequest(policyAddress, requestId);
  relay.params.recipient = request.recipient as Address;
  relay.params.amount = request.amount_atto;
  let execution;
  let record;
  try {
    execution = await executeOneShot(relay);
    record = await genlayerWrite(policyAddress, "record_execution", [requestId, execution.tx_hash]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout relay failed";
    await genlayerWrite(policyAddress, "record_execution_failure", [requestId, message]).catch(() => undefined);
    throw error;
  }
  return { requestId, policy, requestState: await readPolicyRequest(policyAddress, requestId), execution, record };
}

export function requestToApi(row: RequestState, decimals: number) {
  return {
    request_id: row.request_id,
    recipient: row.recipient,
    amount: formatUnits(BigInt(row.amount_atto), decimals),
    amount_units: row.amount_atto,
    category: row.category,
    justification: row.justification,
    verdict: row.verdict,
    reasoning: row.reasoning,
    tx_hash: row.tx_hash,
    execution_status: row.execution_status ?? (row.tx_hash ? "executed" : row.verdict === "approved" ? "approved_pending_execution" : "not_executed"),
    execution_error: row.execution_error ?? "",
    created_at: row.created_at,
  };
}
