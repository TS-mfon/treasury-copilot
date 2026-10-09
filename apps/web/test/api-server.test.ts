import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentApiKeyClaims } from "../src/lib/apiAuth";
import {
  spendBlockers,
  assertPolicyMatchesApiKey,
  chainToApi,
  parseSpendPayload,
  policySecurityProfile,
  publicPolicyState,
  requestToApi,
} from "../src/lib/apiServer";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const platformKey = `0x${"99".repeat(32)}` as const;
const platform = privateKeyToAccount(platformKey);
process.env.AGENT_SIGNER_PRIVATE_KEY = platformKey;

const claims: AgentApiKeyClaims = {
  type: "agent",
  version: 1,
  keyId: "key-12345678",
  keyVersion: 1,
  owner: address("1"),
  agent: address("2"),
  policy: address("3"),
  delegatedAccount: address("4"),
  chainId: 84532,
  token: address("5"),
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  issuedAt: 1_800_000_000,
};

test("spend payload requires a registered agent address and decimal string", () => {
  const parsed = parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "25.00",
    category: "software",
    justification: "Production API invoice",
    idempotency_key: "invoice-2026-0001",
  });
  assert.equal(parsed.agent, claims.agent);
  assert.equal(parsed.amount, "25.00");
});

test("spend payload bounds idempotency and prompt inputs", () => {
  assert.throws(() => parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "1",
    category: "x",
    justification: "valid",
  }), /Category/);
  assert.throws(() => parseSpendPayload({
    agent_address: claims.agent,
    recipient: address("6"),
    amount: "1",
    category: "software",
    justification: "valid",
    idempotency_key: "short",
  }), /idempotency_key/);
});

test("policy binding rejects cross-agent and cross-funding claims", () => {
  const matching = {
    contract_version: "4",
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    evm_chain_id: String(claims.chainId),
    execution_reporter: platform.address,
    delegation_registered: true,
    delegation_payload: { context: "0x01" },
    auto_approve_threshold_atto: "0",
  };
  assert.doesNotThrow(() => assertPolicyMatchesApiKey(matching, claims));
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, authorized_agent: address("7") }, claims), /agent/);
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, delegated_account: address("8") }, claims), /delegated account/);
  assert.throws(() => assertPolicyMatchesApiKey({ ...matching, execution_reporter: address("8") }, claims), /Platform signer/);
});

test("agent policy responses redact executable delegation secrets", () => {
  const state = publicPolicyState({
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    delegation_registered: true,
    delegation_context: "0xsecret",
    delegation_payload: { signature: "secret" },
    evm_chain_id: String(claims.chainId),
    per_tx_cap_atto: "25000000",
  });
  // The agent learns where it settles and whether the binding is usable.
  assert.equal(state.settlement_binding_registered, true);
  assert.equal(state.settlement_chain?.chain_id, claims.chainId);
  assert.equal(state.token_address, claims.token);

  // It must not learn anything it could tune a request against. Caps let an agent size a payment to
  // sit just under the limit, policy text lets it mirror the owner's wording back as justification,
  // and the recipient list lets it enumerate approved payees.
  for (const leaked of [
    "per_tx_cap_atto",
    "weekly_cap_atto",
    "weekly_spent_atto",
    "policy_text",
    "whitelist_enabled",
    "whitelisted_recipients",
    "allowed_destination_chains",
    "policy_nonce",
    "delegated_account",
    "vault_address",
    "delegation_payload",
    "delegation_context",
    "auto_approve_threshold_atto",
  ]) {
    assert.equal(leaked in state, false, `${leaked} must not be exposed to an agent key`);
  }
});

test("a vault-settled policy is not warned about a missing delegation", () => {
  // Arc has no ERC-7715 delegation and never will, so reporting one as missing read as a hard
  // blocker on a binding that was actually complete.
  const arcProfile = policySecurityProfile({
    contract_version: "6",
    settlement_backend: "arc-vault",
    vault_registered: true,
    vault_address: "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2",
    auto_approve_threshold_atto: "0",
  });
  assert.equal(arcProfile.settlement_backend, "arc-vault");
  assert.equal(arcProfile.settlement_binding_registered, true);
  assert.deepEqual(arcProfile.warnings, []);

  // An unregistered vault is still a real blocker, named for the backend it belongs to.
  const unbound = policySecurityProfile({
    contract_version: "6",
    settlement_backend: "arc-vault",
    auto_approve_threshold_atto: "0",
  });
  assert.equal(unbound.settlement_binding_registered, false);
  assert.ok(unbound.warnings.some((w) => w.includes("vault")));
  assert.ok(!unbound.warnings.some((w) => w.includes("delegation")));

  // A delegation-settled policy keeps the original check.
  const delegated = policySecurityProfile({
    contract_version: "6",
    settlement_backend: "delegated-7710",
    auto_approve_threshold_atto: "0",
  });
  assert.ok(delegated.warnings.some((w) => w.includes("delegation")));
});

test("blockers name what is wrong and who has to fix it", () => {
  const arc = {
    contract_version: "6",
    settlement_backend: "arc-vault",
    vault_registered: true,
    vault_address: "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2",
    auto_approve_threshold_atto: "0",
    weekly_cap_atto: "10000000",
    weekly_spent_atto: "0",
  };

  // An unfunded vault is the blocker the agent actually hit, and only the owner can clear it.
  const unfunded = spendBlockers(arc, 0n, 6);
  assert.ok(unfunded.some((b) => b.code === "vault_unfunded" && b.owner_action_required));

  // A funded, bound policy has nothing blocking it.
  assert.deepEqual(spendBlockers(arc, 5_000_000n, 6), []);

  // An exhausted weekly cap is not an owner problem; it clears on its own.
  const exhausted = spendBlockers({ ...arc, weekly_spent_atto: "10000000" }, 5_000_000n, 6);
  assert.ok(exhausted.some((b) => b.code === "weekly_cap_exhausted" && !b.owner_action_required));
});

test("legacy fast approval is surfaced as an explicit security warning", () => {
  const profile = policySecurityProfile({
    contract_version: "2",
    auto_approve_threshold_atto: "5000000",
    delegation_registered: true,
  });
  assert.equal(profile.legacy_fast_approval_active, true);
  assert.equal(profile.semantic_review_required_for_all_requests, false);
  assert.match(profile.warnings[0] ?? "", /without semantic policy review/);
});

test("policy V3 requires semantic review for every request", () => {
  const profile = policySecurityProfile({
    contract_version: "3",
    auto_approve_threshold_atto: "0",
    delegation_registered: true,
  });
  assert.equal(profile.legacy_fast_approval_active, false);
  assert.equal(profile.semantic_review_required_for_all_requests, true);
  assert.equal(profile.asynchronous_review_supported, false);
  assert.equal(profile.immediate_review_submission, false);
  assert.match(profile.warnings[0] ?? "", /migrated to V4/);
});

test("policy V5 starts comparative review in the submission transaction", () => {
  const profile = policySecurityProfile({
    contract_version: "5",
    auto_approve_threshold_atto: "0",
    delegation_registered: true,
  });
  assert.equal(profile.semantic_review_required_for_all_requests, true);
  assert.equal(profile.asynchronous_review_supported, true);
  assert.equal(profile.immediate_review_submission, true);
  assert.deepEqual(profile.warnings, []);
});

test("legacy policies are blocked from asynchronous agent spending", () => {
  assert.throws(() => assertPolicyMatchesApiKey({
    contract_version: "3",
    authorized_agent: claims.agent,
    delegated_account: claims.delegatedAccount,
    token_address: claims.token,
    evm_chain_id: String(claims.chainId),
    execution_reporter: platform.address,
    delegation_registered: true,
    delegation_payload: { context: "0x01" },
    auto_approve_threshold_atto: "0",
  }, claims), /Policy migration required/);
});

test("request responses include chain metadata and decision mode", () => {
  const response = requestToApi({
    request_id: `0x${"a".repeat(64)}`,
    recipient: address("6"),
    amount_atto: "5000001",
    category: "vercel_subscription",
    justification: "Pay a verified Vercel invoice",
    verdict: "approved",
    reasoning: "Matches the exact recipient in policy",
    tx_hash: "",
    created_at: "2026-07-26T12:00:00Z",
    finalized: true,
  }, 6, 84532);

  assert.equal(response.decision_mode, "prompt_comparative");
  assert.equal(response.chain?.name, "Base Sepolia");
  assert.equal(chainToApi(8453).name, "Base Mainnet");
});
