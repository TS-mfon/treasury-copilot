import { formatUnits, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@treasury-copilot/shared";
import type { AgentApiKeyClaims } from "@/lib/apiAuth";
import { genlayerRead, genlayerSubmitWrite, genlayerWrite } from "@/lib/genlayerServer";
import { executeOneShot, type OneShotRelayRequest } from "@/lib/oneShot7710";
import { parseAmount } from "@/lib/amounts";
import { verifyEvidence } from "@/lib/evidence";

export interface SpendPayload {
  agent: Address;
  recipient: Address;
  amount: string;
  category: string;
  justification: string;
  idempotencyKey: string;
  evidence?: unknown;
}

export interface PolicyState {
  contract_version?: string;
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
  policy_nonce?: string;
  whitelist_enabled?: boolean;
  whitelisted_recipients?: string[];
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
  updated_at?: string;
  execution_status?: string;
  execution_error?: string;
  execution_claimed_at?: string;
  finalized?: boolean;
  evidence?: unknown[];
  evidence_digest?: string;
  invoice_key?: string;
}

export function chainToApi(chainId: number) {
  const chain = chainById(chainId);
  if (!chain) {
    return {
      chain_id: chainId,
      name: "Unknown chain",
      explorer_url: null,
    };
  }
  return {
    chain_id: chain.chainId,
    name: chain.name,
    explorer_url: chain.explorerUrl,
  };
}

export function policySecurityProfile(policy: PolicyState) {
  const version = Number(policy.contract_version ?? 0);
  const threshold = BigInt(policy.auto_approve_threshold_atto ?? "0");
  const warnings: string[] = [];

  if (version > 0 && version < 3 && threshold > 0n) {
    warnings.push(
      "This legacy policy can approve requests at or below its fast-approval limit without semantic policy review. Set the limit to 0 and migrate to policy contract V3.",
    );
  }
  if (version > 0 && version < 4) {
    warnings.push("This policy must be migrated to V4 before the asynchronous agent API can accept new spend requests.");
  }
  if (!policy.delegation_registered) {
    warnings.push("No executable delegation is registered for this policy.");
  }

  return {
    contract_version: String(policy.contract_version ?? ""),
    semantic_review_required_for_all_requests: version >= 3,
    asynchronous_review_supported: version >= 4,
    legacy_fast_approval_active: version > 0 && version < 3 && threshold > 0n,
    warnings,
  };
}

export function platformAccount() {
  const key = process.env.AGENT_SIGNER_PRIVATE_KEY?.trim();
  if (!key) throw new Error("Platform signer is not configured");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Platform signer private key must be exactly 32 bytes of hex");
  }
  return privateKeyToAccount(normalized as Hex);
}

export function parseSpendPayload(value: unknown): SpendPayload {
  if (!value || typeof value !== "object") throw new Error("Invalid spend payload");
  const body = value as Record<string, unknown>;
  const recipient = body.recipient;
  const amount = body.amount ?? body.amount_usdc;
  const category = body.category;
  const justification = body.justification;
  const agent = body.agent ?? body.agent_address;
  const idempotencyKey = body.idempotency_key ?? body.idempotencyKey;
  const evidence = body.evidence;

  if (typeof agent !== "string" || !isAddress(agent)) throw new Error("agent_address is required and must be a valid address");
  if (typeof recipient !== "string" || !isAddress(recipient)) throw new Error("Invalid recipient");
  if (typeof amount !== "string" || amount.trim() === "") throw new Error("Invalid amount");
  if (typeof category !== "string" || category.trim().length < 2 || category.trim().length > 64) throw new Error("Category must be 2-64 characters");
  if (typeof justification !== "string" || justification.trim().length < 4 || justification.trim().length > 1200) throw new Error("Justification must be 4-1200 characters");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("idempotency_key must be 8-128 characters using letters, numbers, dot, underscore, colon, or dash");
  }

  return {
    agent: agent as Address,
    recipient: recipient as Address,
    amount: amount.trim(),
    category: category.trim(),
    justification: justification.trim(),
    idempotencyKey,
    evidence,
  };
}

export function amountToUnits(value: string, decimals: number) {
  return parseAmount(value, decimals);
}

export function deriveRequestId(claims: Pick<AgentApiKeyClaims, "policy" | "keyId">, idempotencyKey: string): Hex {
  return keccak256(stringToHex(`${claims.policy}:${claims.keyId}:${idempotencyKey}`));
}

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
}

export function assertPolicyMatchesApiKey(policy: PolicyState, claims: AgentApiKeyClaims) {
  const version = Number(policy.contract_version ?? 0);
  if (version < 4) throw new Error("Policy migration required: agent spending is blocked until this treasury is registered on policy V4");
  if (BigInt(policy.auto_approve_threshold_atto ?? "0") !== 0n) {
    throw new Error("Policy migration required: fast approval must be disabled before agent spending is allowed");
  }
  if (lower(policy.authorized_agent) !== claims.agent.toLowerCase()) throw new Error("API key agent is not authorized for this policy");
  if (lower(policy.delegated_account) !== claims.delegatedAccount.toLowerCase()) throw new Error("API key delegated account does not match policy");
  if (lower(policy.token_address) !== claims.token.toLowerCase()) throw new Error("API key token does not match policy");
  if (String(policy.evm_chain_id ?? "") !== String(claims.chainId)) throw new Error("API key chain does not match policy");
  if (lower(policy.execution_reporter) !== platformAccount().address.toLowerCase()) {
    throw new Error("Platform signer does not match the policy execution reporter");
  }
  if (!policy.delegation_registered || !policy.delegation_payload) throw new Error("Delegation is not registered for this policy");
}

export function publicPolicyState(policy: PolicyState) {
  return {
    contract_version: policy.contract_version ?? "",
    authorized_agent: policy.authorized_agent ?? "",
    delegated_account: policy.delegated_account ?? "",
    token_address: policy.token_address ?? "",
    evm_chain_id: policy.evm_chain_id ?? "",
    per_tx_cap_atto: policy.per_tx_cap_atto ?? "0",
    weekly_cap_atto: policy.weekly_cap_atto ?? "0",
    auto_approve_threshold_atto: policy.auto_approve_threshold_atto ?? "0",
    weekly_spent_atto: policy.weekly_spent_atto ?? "0",
    policy_text: policy.policy_text ?? "",
    policy_nonce: policy.policy_nonce ?? "0",
    whitelist_enabled: policy.whitelist_enabled === true,
    whitelisted_recipients: policy.whitelisted_recipients ?? [],
    delegation_registered: policy.delegation_registered === true,
    security: policySecurityProfile(policy),
  };
}

export async function assertRegistryBinding(claims: AgentApiKeyClaims) {
  const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
  const binding = await genlayerRead<RegistryBinding>(registry, "get_policy", [claims.policy]);
  if (!binding.active) throw new Error("This agent policy is inactive");
  if (lower(binding.policy) !== claims.policy.toLowerCase()) throw new Error("Registry policy does not match API key");
  if (lower(binding.owner) !== claims.owner.toLowerCase() || lower(binding.agent) !== claims.agent.toLowerCase()) throw new Error("Registry owner or agent does not match API key");
  if (lower(binding.delegated_account) !== claims.delegatedAccount.toLowerCase() || lower(binding.token_address) !== claims.token.toLowerCase()) throw new Error("Registry funding binding does not match API key");
  if (String(binding.chain_id) !== String(claims.chainId)) throw new Error("Registry chain does not match API key");
  if (binding.token_symbol !== claims.tokenSymbol || Number(binding.token_decimals) !== claims.tokenDecimals) throw new Error("Registry token metadata does not match API key");
  if (Number(binding.api_key_version ?? 1) !== claims.keyVersion) throw new Error("API key has been rotated or revoked");
  return binding;
}

export async function readPolicyState(policy: Address, state: "latest" | "finalized" = "latest") {
  return await genlayerRead<PolicyState>(policy, "get_policy", [], state);
}

export async function listPolicyRequests(policy: Address, state: "latest" | "finalized" = "latest") {
  return await genlayerRead<string[]>(policy, "list_requests", [], state);
}

export async function readPolicyRequest(policy: Address, requestId: string, state: "latest" | "finalized" = "latest") {
  return await genlayerRead<RequestState>(policy, "get_request", [requestId], state);
}

export async function submitSpendThroughPolicy(claims: AgentApiKeyClaims, payload: SpendPayload) {
  if (payload.agent.toLowerCase() !== claims.agent.toLowerCase()) {
    throw new Error("Request agent does not match API key");
  }

  const policy = await readPolicyState(claims.policy);
  assertPolicyMatchesApiKey(policy, claims);
  await assertRegistryBinding(claims);

  const amountAtto = amountToUnits(payload.amount, claims.tokenDecimals);
  const requestId = deriveRequestId(claims, payload.idempotencyKey);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
  const justificationHash = keccak256(stringToHex(payload.justification));
  const evidence = await verifyEvidence(payload.evidence, {
    chainId: claims.chainId,
    policy: claims.policy,
    token: claims.token,
    recipient: payload.recipient,
    amountUnits: amountAtto,
  });

  const requestIds = await listPolicyRequests(claims.policy);
  if (requestIds.some((id) => id.toLowerCase() === requestId.toLowerCase())) {
    const existing = await readPolicyRequest(claims.policy, requestId);
    const samePayload =
      lower(existing.recipient) === payload.recipient.toLowerCase()
      && existing.amount_atto === amountAtto.toString()
      && existing.category === payload.category
      && existing.justification === payload.justification
      && lower(existing.evidence_digest) === evidence.digest.toLowerCase();
    if (!samePayload) throw new Error("idempotency_key was already used with a different request");
    return {
      requestId,
      policy,
      requestState: existing,
      submit: { hash: null, receipt: null },
      idempotentReplay: true,
    };
  }

  const hash = await genlayerSubmitWrite(claims.policy, "queue_request", [
    payload.recipient,
    amountAtto,
    payload.category,
    payload.justification,
    justificationHash,
    evidence.canonicalJson,
    evidence.digest,
    evidence.invoiceKey,
    requestId,
    deadline,
    claims.agent,
  ]);
  const now = new Date().toISOString();
  const requestState: RequestState = {
    request_id: requestId,
    recipient: payload.recipient,
    amount_atto: amountAtto.toString(),
    category: payload.category,
    justification: payload.justification,
    evidence: evidence.items,
    evidence_digest: evidence.digest,
    invoice_key: evidence.invoiceKey,
    verdict: "pending",
    reasoning: "Submitted to GenLayer and awaiting finalized policy review",
    tx_hash: "",
    created_at: now,
    updated_at: now,
    execution_status: "submitted",
    execution_error: "",
    execution_claimed_at: "",
    finalized: false,
  };
  return {
    requestId,
    policy,
    requestState,
    submit: { hash, receipt: null },
    idempotentReplay: false,
  };
}

export async function reviewQueuedPolicyRequest(policyAddress: Address, requestId: Hex) {
  const request = await readPolicyRequest(policyAddress, requestId, "finalized");
  if (request.verdict !== "pending" || request.execution_status !== "review_pending") {
    return request;
  }
  await genlayerWrite(policyAddress, "review_request", [requestId], "finalized");
  return await readPolicyRequest(policyAddress, requestId, "finalized");
}

export async function executeApprovedPolicyRequest(policyAddress: Address, requestId: Hex) {
  const policy = await readPolicyState(policyAddress, "finalized");
  if (lower(policy.execution_reporter) !== platformAccount().address.toLowerCase()) {
    throw new Error("Platform signer does not match the policy execution reporter");
  }
  if (!policy.delegation_registered || !policy.delegation_payload) throw new Error("Approved request has no active ERC-7715 delegation");
  const registry = process.env.GENLAYER_REGISTRY ?? process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
  if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
  const binding = await genlayerRead<RegistryBinding>(registry as Address, "get_policy", [policyAddress], "finalized");
  if (!binding.active) throw new Error("Policy registry binding is inactive");
  if (
    lower(binding.policy) !== policyAddress.toLowerCase()
    || lower(binding.owner) !== lower(policy.owner)
    || lower(binding.agent) !== lower(policy.authorized_agent)
    || lower(binding.delegated_account) !== lower(policy.delegated_account)
    || lower(binding.token_address) !== lower(policy.token_address)
    || String(binding.chain_id) !== String(policy.evm_chain_id)
  ) {
    throw new Error("Finalized registry binding does not match the approved policy");
  }
  const request = await readPolicyRequest(policyAddress, requestId, "finalized");
  if (!request.finalized) throw new Error("GenLayer request is not finalized for execution");
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

export function requestToApi(row: RequestState, decimals: number, chainId?: number) {
  const executionStatus = row.execution_status ?? (row.tx_hash ? "executed" : row.verdict === "approved" ? "approved_pending_execution" : "not_executed");
  const status = row.tx_hash
    ? "executed"
    : row.verdict === "denied"
      ? "denied"
      : executionStatus === "ready"
        ? "approved"
        : executionStatus;
  const explorer = chainId ? chainById(chainId)?.explorerUrl : undefined;
  const decisionMode = row.reasoning === "Within auto-approve threshold"
    || row.reasoning === "Within fast-approval threshold"
    ? "legacy_fast_approval"
    : row.verdict === "denied" && (
      row.reasoning === "Amount must be greater than zero"
      || row.reasoning === "Exceeds per-transaction cap"
      || row.reasoning === "Would exceed weekly cap"
      || row.reasoning === "Recipient not on whitelist"
    )
      ? "deterministic"
      : "prompt_comparative";
  return {
    request_id: row.request_id,
    recipient: row.recipient,
    amount: formatUnits(BigInt(row.amount_atto), decimals),
    amount_units: row.amount_atto,
    category: row.category,
    justification: row.justification,
    evidence: row.evidence ?? [],
    evidence_digest: row.evidence_digest ?? "",
    invoice_key: row.invoice_key ?? "",
    verdict: row.verdict,
    decision_mode: decisionMode,
    status,
    reasoning: row.reasoning,
    tx_hash: row.tx_hash,
    execution_status: executionStatus,
    execution_error: row.execution_error ?? "",
    execution_claimed_at: row.execution_claimed_at ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    explorer_url: row.tx_hash && explorer ? `${explorer}/tx/${row.tx_hash}` : null,
    chain: chainId ? chainToApi(chainId) : null,
  };
}
