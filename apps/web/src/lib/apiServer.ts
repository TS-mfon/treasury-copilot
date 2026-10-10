import { formatUnits, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@treasury-copilot/shared";
import type { AgentApiKeyClaims } from "@/lib/apiAuth";
import { genlayerRead, genlayerSubmitWrite, genlayerWrite } from "@/lib/genlayerServer";
import { executeOneShot, type OneShotRelayRequest } from "@/lib/oneShot7710";
import { executeArcVaultPayout } from "@/lib/arcVault";
import { assertSettlementAvailable, settlementBackendForChainId } from "@/lib/executionBackend";
import { parseAmount } from "@/lib/amounts";
import { env } from "@/lib/env";
import { verifyEvidence } from "@/lib/evidence";

export interface SpendPayload {
  agent: Address;
  recipient: Address;
  amount: string;
  category: string;
  justification: string;
  idempotencyKey: string;
  evidence?: unknown;
  /** Chain the payee is paid on. Defaults to the policy's own settlement chain. */
  destinationChainId?: number;
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
  settlement_backend?: string;
  vault_address?: string;
  vault_registered?: boolean;
  allowed_destination_chains?: string[];
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
  destination_chain_id?: string;
  route?: string;
  bridge_tx_hash?: string;
  attestation_status?: string;
  destination_tx_hash?: string;
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
  if (version === 4) {
    warnings.push("This policy uses the legacy two-transaction review flow. Re-register the delegation to migrate to V5 immediate review.");
  }
  // A vault-settled policy has no ERC-7715 delegation and never will, so reporting a missing one
  // was a false alarm that read as a hard blocker. Each backend is checked against the binding it
  // actually requires.
  const vaultSettled = (policy.settlement_backend ?? "delegated-7710") === "arc-vault";
  if (vaultSettled) {
    if (!policy.vault_registered && !isAddress(String(policy.vault_address ?? ""))) {
      warnings.push("No agent treasury vault is registered for this policy.");
    }
  } else if (!policy.delegation_registered) {
    warnings.push("No executable delegation is registered for this policy.");
  }

  return {
    contract_version: String(policy.contract_version ?? ""),
    settlement_backend: vaultSettled ? "arc-vault" : "delegated-7710",
    semantic_review_required_for_all_requests: version >= 3,
    asynchronous_review_supported: version >= 4,
    immediate_review_submission: version >= 5,
    legacy_fast_approval_active: version > 0 && version < 3 && threshold > 0n,
    // The binding this policy actually needs, so a client never has to guess which field matters.
    settlement_binding_registered: vaultSettled
      ? policy.vault_registered === true || isAddress(String(policy.vault_address ?? ""))
      : policy.delegation_registered === true,
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
  const destination = body.destination_chain ?? body.destination_chain_id ?? body.destinationChainId;

  // isAddress is checksum-strict by default, so an address whose casing differs from EIP-55 was
  // rejected with a message claiming it was absent or malformed -- including the agent's own
  // address as encoded in its API key. Addresses are compared case-insensitively everywhere else,
  // so they are validated structurally here and the mismatch message names the real cause.
  if (typeof agent !== "string" || !isAddress(agent, { strict: false })) {
    throw new Error("agent_address is required and must be a 20-byte hex address");
  }
  if (typeof recipient !== "string" || !isAddress(recipient, { strict: false })) {
    throw new Error("Invalid recipient: must be a 20-byte hex address");
  }
  if (typeof amount !== "string" || amount.trim() === "") throw new Error("Invalid amount");
  if (typeof category !== "string" || category.trim().length < 2 || category.trim().length > 64) throw new Error("Category must be 2-64 characters");
  if (typeof justification !== "string" || justification.trim().length < 4 || justification.trim().length > 1200) throw new Error("Justification must be 4-1200 characters");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("idempotency_key must be 8-128 characters using letters, numbers, dot, underscore, colon, or dash");
  }

  let destinationChainId: number | undefined;
  if (destination !== undefined && destination !== null && destination !== "") {
    const parsed = typeof destination === "number" ? destination : Number(String(destination).trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("destination_chain must be a positive integer chain id");
    }
    // Reject an unknown chain here so the agent gets a clear error instead of a GenLayer denial.
    if (!chainById(parsed)) throw new Error(`destination_chain ${parsed} is not a supported chain`);
    destinationChainId = parsed;
  }

  return {
    agent: agent as Address,
    recipient: recipient as Address,
    amount: amount.trim(),
    category: category.trim(),
    justification: justification.trim(),
    idempotencyKey,
    evidence,
    destinationChainId,
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
  // Arc settles through a vault the owner deployed, so it has no ERC-7715 delegation to register.
  // The vault address occupies the same `delegated_account` slot the delegation path uses, which
  // is why the registry binding checks above still apply unchanged.
  if (settlementBackendForChainId(claims.chainId) === "arc-vault") {
    assertSettlementAvailable(claims.chainId);
    const vault = vaultAddressFor(policy);
    if (!vault) throw new Error("No agent treasury vault is registered for this policy");
    // On a V6 policy the vault is explicit. Older shapes reuse `delegated_account`, which the
    // registry binding checks above already pinned, so both are safe to accept.
    if (Number(policy.contract_version ?? 0) >= 6 && policy.vault_registered !== true) {
      throw new Error("Policy migration required: register the agent treasury vault before spending");
    }
    return;
  }
  if (!policy.delegation_registered || !policy.delegation_payload) throw new Error("Delegation is not registered for this policy");
}

/**
 * Resolve the Arc settlement vault for a policy.
 *
 * V6 stores it explicitly in `vault_address`. Earlier shapes carry it in `delegated_account`,
 * which is the slot the registry binding pins for Arc, so it is an equally verified source.
 */
export interface SpendRequestIdentity {
  recipient: Address;
  amountUnits: bigint;
  category: string;
  justification: string;
  destinationChainId: number;
  evidenceDigest: string;
  /** Used to read a pre-V6 record, which has no stored destination, as its own settlement chain. */
  settlementChainId: number;
}

/**
 * Whether a replayed idempotency key describes the same payment as the stored request.
 *
 * The destination chain is part of a request's identity. Without it, one key could be replayed
 * with a different destination and be accepted as an already-approved payment, which would let a
 * caller redirect approved funds to another chain.
 */
export function isSameSpendRequest(existing: RequestState, candidate: SpendRequestIdentity): boolean {
  const existingDestination = String(existing.destination_chain_id ?? candidate.settlementChainId);
  return (
    lower(existing.recipient) === candidate.recipient.toLowerCase()
    && existing.amount_atto === candidate.amountUnits.toString()
    && existing.category === candidate.category
    && existing.justification === candidate.justification
    && existingDestination === String(candidate.destinationChainId)
    && lower(existing.evidence_digest) === candidate.evidenceDigest.toLowerCase()
  );
}

export function vaultAddressFor(policy: PolicyState): Address | undefined {
  const explicit = String(policy.vault_address ?? "");
  if (isAddress(explicit)) return explicit as Address;
  const funding = String(policy.delegated_account ?? "");
  return isAddress(funding) ? (funding as Address) : undefined;
}

export interface SpendBlocker {
  code: string;
  message: string;
  /** Whether the agent can clear this itself, or whether it needs the owner. */
  owner_action_required: boolean;
}

/**
 * Why a treasury cannot pay right now, as a flat list an agent can act on.
 *
 * Previously the only signal was a nested `warnings` array, so "there is no money" and "the policy
 * is misconfigured" looked the same and neither said who had to fix it.
 */
export function spendBlockers(
  policy: PolicyState,
  balanceUnits: bigint,
  decimals: number,
): SpendBlocker[] {
  const blockers: SpendBlocker[] = [];
  const profile = policySecurityProfile(policy);

  if (!profile.settlement_binding_registered) {
    blockers.push({
      code: profile.settlement_backend === "arc-vault"
        ? "vault_not_registered"
        : "delegation_not_registered",
      message: profile.settlement_backend === "arc-vault"
        ? "No agent treasury vault is registered for this policy."
        : "No executable delegation is registered for this policy.",
      owner_action_required: true,
    });
  }
  if (balanceUnits === 0n) {
    blockers.push({
      code: "vault_unfunded",
      message: profile.settlement_backend === "arc-vault"
        ? "The agent treasury vault holds no USDC. The owner must top it up before any payment can settle."
        : "The funding account holds no USDC.",
      owner_action_required: true,
    });
  }
  const weeklyCap = BigInt(policy.weekly_cap_atto ?? "0");
  const weeklySpent = BigInt(policy.weekly_spent_atto ?? "0");
  if (weeklyCap > 0n && weeklySpent >= weeklyCap) {
    blockers.push({
      code: "weekly_cap_exhausted",
      message: `The weekly cap of ${formatUnits(weeklyCap, decimals)} is fully spent. It resets seven days after the window opened.`,
      owner_action_required: false,
    });
  }
  return blockers;
}

/**
 * What an agent is allowed to learn about its own policy.
 *
 * Deliberately excludes the caps, the remaining weekly budget, the policy text and the recipient
 * whitelist. An agent that can read those can size a request to sit just under a cap, mirror the
 * policy's own wording back in its justification, and enumerate approved recipients — in other
 * words, tune itself past the controls instead of being governed by them. The owner still sees all
 * of it through the owner endpoints.
 *
 * What remains is only what an agent needs to form a valid request: where it settles, which token
 * and precision to use, and whether the binding is usable at all.
 */
export function publicPolicyState(policy: PolicyState) {
  const profile = policySecurityProfile(policy);
  return {
    contract_version: profile.contract_version,
    authorized_agent: policy.authorized_agent ?? "",
    settlement_backend: profile.settlement_backend,
    settlement_chain: chainToApi(Number(policy.evm_chain_id ?? 0)),
    token_address: policy.token_address ?? "",
    settlement_binding_registered: profile.settlement_binding_registered,
    review: {
      semantic_review_required_for_all_requests: profile.semantic_review_required_for_all_requests,
      immediate_review_submission: profile.immediate_review_submission,
    },
    warnings: profile.warnings,
    // Caps, weekly spend, policy text, recipient whitelist and the destination allowlist are
    // withheld on purpose. A denial names its reason, so an agent still learns why a request was
    // refused without being handed the thresholds to design around.
    disclosure: "Policy thresholds, policy text and recipient lists are not exposed to agent keys. A denied request states its reason.",
  };
}


/**
 * Enforce the GenLayer policy allowlist.
 *
 * `ALLOWED_GENLAYER_POLICY_ADDRESSES` was previously parsed into `env().allowedGenlayerPolicyAddresses`
 * and never read, so it looked like a control and was not one. An empty list means unrestricted,
 * which preserves existing deployments; a non-empty list is now actually enforced.
 */
export function assertPolicyAllowed(policy: Address, allowed?: ReadonlySet<string>) {
  const list = allowed ?? env().allowedGenlayerPolicyAddresses;
  if (list.size === 0) return;
  if (!list.has(policy.toLowerCase())) {
    throw new Error("This policy address is not allowed on this deployment");
  }
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

  assertPolicyAllowed(claims.policy);
  const policy = await readPolicyState(claims.policy);
  assertPolicyMatchesApiKey(policy, claims);
  await assertRegistryBinding(claims);

  const amountAtto = amountToUnits(payload.amount, claims.tokenDecimals);
  const destinationChainId = payload.destinationChainId ?? claims.chainId;
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
    const samePayload = isSameSpendRequest(existing, {
      recipient: payload.recipient,
      amountUnits: amountAtto,
      category: payload.category,
      justification: payload.justification,
      destinationChainId,
      evidenceDigest: evidence.digest,
      settlementChainId: claims.chainId,
    });
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
    String(destinationChainId),
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
    destination_chain_id: String(destinationChainId),
    route: destinationChainId === claims.chainId ? "direct" : "cctp",
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
  assertPolicyAllowed(policyAddress);
  const policy = await readPolicyState(policyAddress, "finalized");
  if (lower(policy.execution_reporter) !== platformAccount().address.toLowerCase()) {
    throw new Error("Platform signer does not match the policy execution reporter");
  }
  const settlementBackend = settlementBackendForChainId(Number(policy.evm_chain_id));
  if (settlementBackend === "arc-vault") {
    assertSettlementAvailable(Number(policy.evm_chain_id));
    if (!vaultAddressFor(policy)) {
      throw new Error("Approved request has no registered agent treasury vault");
    }
  } else if (!policy.delegation_registered || !policy.delegation_payload) {
    throw new Error("Approved request has no active ERC-7715 delegation");
  }
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
    execution = settlementBackend === "arc-vault"
      ? await executeArcVaultPayout({
          chainId: Number(policy.evm_chain_id),
          vault: vaultAddressFor(policy) as Address,
          requestId,
          recipient: request.recipient as Address,
          amount: request.amount_atto,
          destinationChainId: Number(request.destination_chain_id ?? policy.evm_chain_id),
        })
      : await executeOneShot(relay);

    // A CCTP burn is not yet the payee's receipt, so it is recorded as a bridge initiation and the
    // cron bridge stage completes the request once Circle has minted on the destination chain.
    const bridged = "route" in execution && execution.route === "cctp";
    record = bridged
      ? await genlayerWrite(policyAddress, "record_bridge_initiated", [requestId, execution.tx_hash])
      : await genlayerWrite(policyAddress, "record_execution", [requestId, execution.tx_hash]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout relay failed";
    await genlayerWrite(policyAddress, "record_execution_failure", [requestId, message]).catch(() => undefined);
    throw error;
  }
  return { requestId, policy, requestState: await readPolicyRequest(policyAddress, requestId), execution, record };
}

/**
 * Machine-readable denial cause, derived from the reason the policy stored on chain.
 *
 * The deterministic guards already record a precise sentence, so the code is read from that rather
 * than requiring a contract change. A denial from the comparative review has no finer cause
 * available: that path compares only the approved boolean so validators can agree, which is why a
 * free-form reason cannot be trusted from it.
 */
export function denialCodeFor(row: Pick<RequestState, "verdict" | "reasoning">): string | null {
  if (row.verdict !== "denied") return null;
  const reason = String(row.reasoning ?? "").toLowerCase();
  if (reason.includes("not on whitelist")) return "recipient_not_approved";
  if (reason.includes("per-transaction cap")) return "amount_above_cap";
  if (reason.includes("weekly cap")) return "weekly_cap_exhausted";
  if (reason.includes("destination chain")) return "destination_not_permitted";
  if (reason.includes("already used by another request")) return "evidence_required";
  if (reason.includes("greater than zero")) return "amount_above_cap";
  return "policy_text_rejected";
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
    denial_code: denialCodeFor(row),
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
    route: row.route ?? "direct",
    destination_chain: row.destination_chain_id
      ? chainToApi(Number(row.destination_chain_id))
      : chainId
        ? chainToApi(chainId)
        : null,
    bridge: {
      tx_hash: row.bridge_tx_hash ?? "",
      attestation_status: row.attestation_status ?? "",
      destination_tx_hash: row.destination_tx_hash ?? "",
      destination_explorer_url: row.destination_tx_hash && row.destination_chain_id
        ? `${chainById(Number(row.destination_chain_id))?.explorerUrl ?? ""}/tx/${row.destination_tx_hash}`
        : null,
    },
  };
}
