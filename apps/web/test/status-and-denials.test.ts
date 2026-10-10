import assert from "node:assert/strict";
import test from "node:test";
import { denialCodeFor, parseSpendPayload, requestToApi } from "../src/lib/apiServer";
import { isTerminalStatus, statusLabel, statusTone } from "../src/lib/statusLabels";
import type { RequestState } from "../src/lib/apiServer";
import type { Address } from "viem";

const agent = "0x5905c9DeA6Ae52AA0947D8F7F218263889eDfC4E";
const recipient = "0xdcE1AE1Deb32d990dFf06A0fcba435Ea9FAD39d9";

function body(overrides: Record<string, unknown> = {}) {
  return {
    agent_address: agent,
    recipient,
    amount: "5.00",
    category: "api_subscription",
    justification: "OpenAI API developer usage billing",
    idempotency_key: "openai-api-20261009-004",
    ...overrides,
  };
}

test("an address whose casing is not EIP-55 is accepted rather than reported as missing", () => {
  // The agent's own address, as encoded in the issued key, differs in casing from the EIP-55 form
  // that /balance returns. Copying it out of the token used to fail with "agent_address is required
  // and must be a valid address", which named the wrong cause.
  const payload = parseSpendPayload(body());
  assert.equal(payload.agent.toLowerCase(), agent.toLowerCase());
  assert.equal(payload.recipient.toLowerCase(), recipient.toLowerCase());

  // All-lowercase and all-uppercase forms are equivalent too.
  assert.doesNotThrow(() => parseSpendPayload(body({ agent_address: agent.toLowerCase() })));
  assert.doesNotThrow(() => parseSpendPayload(body({ recipient: recipient.toLowerCase() })));
});

test("a structurally invalid address is still refused, with an accurate message", () => {
  assert.throws(() => parseSpendPayload(body({ agent_address: "0x1234" })), /20-byte hex address/);
  assert.throws(() => parseSpendPayload(body({ recipient: "not-an-address" })), /20-byte hex address/);
  assert.throws(() => parseSpendPayload(body({ agent_address: undefined })), /20-byte hex address/);
});

// --- denial codes ------------------------------------------------------------------------------

function denied(reasoning: string): RequestState {
  return {
    request_id: "0xabc",
    recipient,
    amount_atto: "5000000",
    category: "api_subscription",
    justification: "billing",
    verdict: "denied",
    reasoning,
    tx_hash: "",
    created_at: "2026-10-09T00:00:00Z",
  };
}

test("a denial names its cause in machine-readable form", () => {
  // Without this an agent cannot tell a missing whitelist entry from missing evidence, which is the
  // difference between asking the owner to approve a recipient and supplying a document.
  assert.equal(denialCodeFor(denied("Recipient not on whitelist")), "recipient_not_approved");
  assert.equal(denialCodeFor(denied("Exceeds per-transaction cap")), "amount_above_cap");
  assert.equal(denialCodeFor(denied("Would exceed weekly cap")), "weekly_cap_exhausted");
  assert.equal(denialCodeFor(denied("Destination chain is not permitted by this policy")), "destination_not_permitted");
  assert.equal(denialCodeFor(denied("Amount must be greater than zero")), "amount_above_cap");
});

test("a comparative-review denial reports that the policy text rejected it", () => {
  // This path compares only the approved boolean so validators can agree, so no finer cause exists.
  assert.equal(
    denialCodeFor(denied("Denied by GenLayer prompt-comparative policy review")),
    "policy_text_rejected",
  );
});

test("a non-denied request carries no denial code", () => {
  for (const verdict of ["approved", "pending"]) {
    assert.equal(denialCodeFor({ verdict, reasoning: "Recipient not on whitelist" }), null);
  }
});

test("the API response carries the denial code alongside the verdict", () => {
  const api = requestToApi(denied("Recipient not on whitelist"), 6, 5042002);
  assert.equal(api.verdict, "denied");
  assert.equal(api.denial_code, "recipient_not_approved");
});

// --- status labels -----------------------------------------------------------------------------

test("not_applicable reads as Denied, because that is what it means", () => {
  // The policy stores "not_applicable" when a denial means execution never applies. Shown raw it
  // reads as "unknown" rather than "denied", which is how a denied row looked like a pending one.
  assert.equal(statusLabel("not_applicable"), "Denied");
  assert.equal(statusTone("not_applicable"), "danger");
  assert.equal(statusLabel("executed"), "Accepted / Executed");
  assert.equal(statusTone("executed"), "success");
  assert.equal(statusLabel("bridging"), "Bridging to destination");
  assert.equal(statusTone("bridging"), "pending");
});

test("an unrecognised status degrades to something readable, not blank", () => {
  assert.equal(statusLabel("some_new_state"), "some new state");
  assert.equal(statusLabel(undefined), "Unknown");
  assert.equal(statusTone("some_new_state"), "neutral");
});

test("terminal states are identified so a poller can stop", () => {
  assert.equal(isTerminalStatus("executed"), true);
  assert.equal(isTerminalStatus("denied"), true);
  assert.equal(isTerminalStatus("not_applicable"), true);
  assert.equal(isTerminalStatus("bridging"), false);
  assert.equal(isTerminalStatus("submitted"), false);
  assert.equal(isTerminalStatus(undefined), false);
});

test("the payee's receipt is the destination hash, not the burn", () => {
  const api = requestToApi({
    ...denied("ok"),
    verdict: "approved",
    execution_status: "bridging",
    destination_chain_id: "84532",
    route: "cctp",
    bridge_tx_hash: "0xburn",
    attestation_status: "pending",
    destination_tx_hash: "",
  }, 6, 5042002);
  // While bridging, the burn exists but the payee has not been credited.
  assert.equal(api.bridge.tx_hash, "0xburn");
  assert.equal(api.bridge.destination_tx_hash, "");
  assert.equal(api.bridge.destination_explorer_url, null);
});

test("an all-lowercase agent address passes every later check that compares it", () => {
  const payload = parseSpendPayload(body({ agent_address: agent.toLowerCase() as Address }));
  assert.equal(payload.agent.toLowerCase(), agent.toLowerCase());
});
