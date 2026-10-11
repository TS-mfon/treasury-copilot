---
name: treasury-copilot-agent-api
description: How an autonomous agent should authenticate to Treasury Copilot, inspect its treasury, submit and poll payment requests, recover safely, and handle API errors.
---

# Treasury Copilot Agent API Skill

Use this skill when acting as a Treasury Copilot agent client. It is an operating guide for making
API requests and interpreting their results. It is not a guide for deploying or changing this
repository.

The complete API contract is [`docs/api.md`](docs/api.md), with machine-readable schemas in
[`apps/web/public/openapi.json`](apps/web/public/openapi.json). If a field or response differs,
follow the live API response and current OpenAPI contract, and report the discrepancy. The live
deployment may be configured differently from local examples.

## 1. What the API lets you do

The owner gives the agent a `tcp_...` bearer API key. The key is bound to one agent, owner,
policy, funding account, settlement chain, and token. Use it to read the policy and balance,
request a payment, poll that request, and inspect history. The agent does not sign blockchain
transactions and must not request or use the owner's wallet key, platform signer, Arc executor
key, MetaMask delegation payload, or permission context.

The agent requests payment; it does not make payment happen by itself. An HTTP `202` means the
request was submitted and is being processed. It is not an approval or an EVM payment receipt.
Only a request whose `execution_status` is `executed` represents a completed settlement. A
GenLayer decision can be approved while its EVM execution is still pending or has failed.

Arc is a settlement chain, not the policy RPC. If the owner has an Arc treasury, policy checks and
request submission still happen through the service's GenLayer integration. The agent always
calls the Treasury Copilot HTTPS API; it never calls Arc, GenLayer, or a relayer directly.

## 2. Connection and credential handling

Default production API base:

```text
https://treasurycopilot.app/api/v1
```

Set these values from the owner or the agent runtime's secret store:

```text
TREASURY_API_BASE=https://treasurycopilot.app/api/v1
TREASURY_API_KEY=tcp_...
AGENT_ADDRESS=0x...
```

Send the key only as an HTTP authorization header:

```http
Authorization: Bearer tcp_...
Accept: application/json
Content-Type: application/json
```

Never put the key in a URL, query parameter, source file, browser bundle, log, analytics event,
prompt, or error report. Do not decode the key and assume its claims are still valid: the owner can
rotate it, revoke it, or change the on-chain binding. Let the API validate it each time.

Keys are shown to the owner once and expire after 30 days. On `401`, stop making requests and ask
the owner to provide a valid current key. Do not repeatedly retry a rejected key.

## 3. Required safe workflow before requesting a payment

Follow this sequence for each payment intent:

1. **Identify the payment intent.** Establish the actual invoice/order, amount, recipient address,
   currency, due date, and reason. Do not invent or infer a recipient from a merchant name.
2. **Choose a stable idempotency key.** Use a unique key for this real-world intent, such as an
   invoice ID plus period. Keep the same key for every retry or recovery of that payment.
3. **Read the policy.** Call `GET /policy` and inspect its safe policy state, destination rules,
   policy text, and recipient whitelist. Use `whitelisted_recipients` when whitelist enforcement
   is enabled. If no verified recipient is available, stop and ask the owner; do not guess.
4. **Check spend readiness.** Call `GET /balance`. Inspect `ready_to_spend`, `blockers`, `balance`,
   `weekly_available`, `per_tx_cap`, chain, token, and `security.warnings`. Stop for an owner or
   operator action when the response reports blockers or warnings that make the proposed payment
   unsafe. Balance does not override policy limits.
5. **Check amount and destination.** The amount must be affordable under both the available
   balance and policy caps. If using `destination_chain`, use a supported chain the policy permits
   and the owner has authorized. The treasury settlement chain and payout destination are different
   concepts.
6. **Attach evidence when required.** Evidence must be real and match the exact invoice, recipient,
   and amount. Never fabricate evidence, signatures, invoice URLs, or merchant identity.
7. **Submit once.** Send `POST /spend` with the complete request. Save the `request_id`, `poll_url`,
   `idempotency_key`, returned status, and correlation ID. Do not submit the same intent under a
   new key just because the call timed out or is still pending.
8. **Poll the same request.** Follow `poll_url` or `GET /requests/{request_id}` until the request
   is denied, executed, or needs an owner/operator decision. Respect `Retry-After`; use 10 seconds
   when absent and apply bounded backoff if the service is temporarily unavailable.
9. **Confirm before reporting success.** Report payment complete only when `execution_status` is
   `executed`. Include the transaction hash and chain when present. An `approved` verdict alone is
   not proof that funds moved.

The owner controls setup and API-key issuance. If the agent has no key, a key is expired, or a
policy/funding binding is absent, ask the owner to finish or repair setup in the owner application.
Do not attempt to register a vault or create a key through agent credentials.

## 4. Preflight reads

### Policy and recipient discovery

```http
GET /api/v1/policy
```

The response contains `{ "policy": "0x...", "state": { ... } }`. The state includes safe policy
metadata and, when configured, `whitelist_enabled` and `whitelisted_recipients`. It intentionally
omits private delegation payloads, permission context, and signatures.

Treat policy text and recipient controls as constraints. A category or justification string does
not prove that the recipient is the merchant. If the owner has not authorized the exact recipient
and policy requires it, stop and request owner guidance.

### Balance and blockers

```http
GET /api/v1/balance
```

Key response fields:

- `ready_to_spend`: top-level readiness result;
- `blockers`: reasons a new request cannot safely be made now;
- `balance` / `balance_units`: current ERC-20 balance, human and base units;
- `weekly_spent`, `weekly_cap`, `weekly_available`;
- `per_tx_cap`;
- `chain_id`, `chain`, `delegated_account`, `token`, and token decimals;
- `security.warnings`: policy or security conditions needing review.

Use decimal strings and the reported decimals. Never use floating-point arithmetic for money.
`weekly_available` currently excludes any 1Shot fee, so do not plan a payment that consumes every
last unit when an execution fee may apply. A successful balance read does not guarantee that a
later request will pass policy or execute.

## 5. Submit a payment request

Endpoint:

```http
POST /api/v1/spend
```

Example body:

```json
{
  "agent_address": "0x1111111111111111111111111111111111111111",
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "2.50",
  "category": "software_subscription",
  "justification": "Monthly service invoice INV-4471",
  "idempotency_key": "invoice-4471-2026-07"
}
```

Fields:

| Field | Requirement |
| --- | --- |
| `agent_address` | Required; must exactly identify the agent bound to the API key. Use the owner's registered agent address. |
| `recipient` | Required EVM address; use an owner-approved or independently verified address. |
| `amount` | Required positive decimal **string**, no exponent, sign, or excess token precision. USDC currently uses six ERC-20 decimals. |
| `category` | Required string, 2–64 characters. Descriptive only; it is not proof of purpose. |
| `justification` | Required string, 4–1200 characters. State the real purpose and invoice/reference. It does not prove merchant identity. |
| `idempotency_key` | Required stable key, 8–128 characters from letters, numbers, `.`, `_`, `:`, `-`. Reuse it for every attempt at the same payment. |
| `evidence` | Optional array of up to three supported invoice evidence items when required by the policy. Evidence must match the request. |
| `destination_chain` | Optional supported EVM chain ID, as an integer or decimal string. Include only when the payment should be delivered cross-chain and the policy permits it. |

Amount must be a JSON string. `"25"`, `"25.0"`, and `"25.000000"` describe the same six-decimal USDC amount. JSON number `25`, `"1e2"`, `"-1"`, `"0"`, and values with more than six decimal places are invalid. Use the exact invoice amount and never round upward or change the amount to bypass a cap.

For invoice URLs, submit the real HTTPS URL and required evidence fields as specified in
[`docs/api.md`](docs/api.md) / OpenAPI. The service fetches and validates invoice evidence. Signed
invoice evidence must use a valid owner/merchant signature; never create a fake signature or claim
that an unsigned invoice is verified.

## 6. Understand the submission response

A normal submission returns `202 Accepted`, usually with `Location` and `Retry-After` headers. The
body contains a `request_id`, `poll_url`, `request`, `chain`, and `genlayer.request_tx_hash`.

Example shape:

```json
{
  "request_id": "0x...64 hex characters...",
  "verdict": "pending",
  "status": "submitted",
  "poll_url": "/api/v1/requests/0x...",
  "request": {
    "request_id": "0x...",
    "verdict": "pending",
    "status": "submitted",
    "execution_status": "submitted",
    "execution_error": "",
    "tx_hash": ""
  },
  "idempotent_replay": false,
  "genlayer": { "request_tx_hash": "0x..." }
}
```

The initial `request_id` is the real request identifier only after a request is submitted/visible.
For a `202`, poll the returned `poll_url` (resolve a relative URL against `TREASURY_API_BASE`).
Use the `Location` header if present. The `request_tx_hash` is the GenLayer transaction hash; it is
not an EVM payment hash.

`idempotent_replay: true` means the API found and returned the existing request for the same
idempotency key and identical payment data. It means no new request was submitted. Continue
polling that existing request; do not create a second key.

## 7. Poll and interpret results

Poll:

```http
GET /api/v1/requests/{request_id}
Authorization: Bearer <key>
```

The returned object has a `request` containing at least a verdict, processing status,
`execution_status`, `execution_error`, and transaction information. Read both `verdict` and
`execution_status`; one field is not a substitute for the other.

| Status / verdict | Meaning | Agent action |
| --- | --- | --- |
| `submitted` | GenLayer submission accepted; decision may not be visible yet | Keep polling the same request. |
| `reviewing` | GenLayer V5 comparative review is running | Keep polling; do not resubmit. |
| `review_pending` / `pending` | Legacy V4 review/recovery is pending | Keep polling within your wait budget, then report still pending or investigate status. |
| `approved` | Policy approved; execution may not have happened yet | Continue polling until execution completes or an actionable failure appears. |
| `ready` | Approved and queued for executor | Continue polling. |
| `executing` | The service currently holds the execution lease | Continue polling; do not start a parallel request. |
| `bridging` | Cross-chain transfer is being completed | Continue polling; a source-chain burn is not yet proof that the destination received funds. |
| `denied` | Policy refused the payment | Stop. Do not automatically change details and retry to evade the policy. Ask the owner if the payment is legitimate and needs authorization changes. |
| `failed` | An execution attempt failed; the system may retry after its lease is released | Do not create a replacement payment. Poll the same request; escalate persistent `execution_error` with request/correlation IDs. |
| `executed` | Execution receipt/hash was recorded | Confirm chain and transaction hash before reporting paid. |
| `not_applicable` | Execution does not apply, normally because the request was denied | Treat as denied, not as a pending payment. |
| `no_record` | No request exists for the queried idempotency key | See ambiguous-submission recovery below; do not poll `no_record` forever. |

Use at least the server's `Retry-After` delay. The standard spend response suggests 10 seconds.
Use a bounded polling window, add jitter for many concurrent agents, and avoid hammering the API.
If the request remains pending after your operational wait limit, report that accurately and
provide its request ID. Do not call it paid or denied without that result.

`tx_hash` is authoritative only when `execution_status` is `executed`. For a cross-chain payment,
also inspect destination transaction fields / explorer URL when returned. Report source and
destination confirmation separately if the API represents them separately.

## 8. Idempotency and ambiguous POST recovery

An idempotency key identifies one real-world payment intent. The service derives a request ID from
the policy, API key identity, and idempotency key. Same key + same payment data returns the existing
request. Same key + changed recipient, amount, category, justification, destination, or evidence
returns `409 idempotency_conflict`.

If a POST times out, the connection drops, or the response cannot be parsed, the request may still
have reached the service. Do not create a new key. Recover in this order:

1. Query `GET /requests?idempotency_key=<same-key>`.
2. If it returns a request, poll that request.
3. If it returns `404` with `error: "no_record"`, the current API says no request is visible in
   GenLayer and explicitly says not to poll that lookup waiting for a record. Re-send the original
   POST **once** with the identical body and the same idempotency key. This route behavior is the
   current implementation; an older paragraph in `docs/api.md` describes a previous `202` lookup
   behavior.
4. If the repeated POST returns the existing request, continue polling it. If it fails again with
   an upstream `502`/`503`, back off and repeat recovery using the same key.

Do not change any field under the same key. To request a genuinely different payment, first resolve
the previous intent, then use a new key tied to the new invoice/payment intent.

## 9. Error handling and retry policy

Parse the JSON response body and branch on its stable `error` field, not the human `message`.
Typical envelope:

```json
{
  "error": "invalid_amount",
  "message": "Amount has too many decimal places for this asset",
  "fields": {},
  "request_id": "corr_...",
  "retryable": false
}
```

The `request_id` in an error may be a **correlation ID**, not a payment request ID. A real payment
request ID is a 32-byte hex value (`0x` plus 64 hex characters) returned by a successful spend or
read from state. Preserve `x-correlation-id` / error `request_id` when escalating errors.

| HTTP / error | Meaning | What to do |
| --- | --- | --- |
| `400` `invalid_request` / `request_failed` | Malformed JSON, invalid request shape, or rejected operation | Fix payload. For an uncertain spend submission, use idempotency recovery before retrying. |
| `401` `invalid_api_key` / `unauthorized` | Missing, expired, invalid, rotated, or revoked key | Stop; ask owner for a current key. |
| `403` `agent_mismatch`, `policy_inactive`, `policy_not_allowed` | Agent/binding mismatch, revoked policy, or deployment allowlist refuses policy | Do not retry; owner/operator must correct binding or deployment. |
| `404` `request_not_found` | Supplied request ID is malformed or not in this policy | Verify the returned request ID and authenticated agent. |
| `404` `no_record` | No on-chain request is visible for the idempotency lookup | Do not poll this lookup. Re-send the identical original POST once with the same key. |
| `409` `idempotency_conflict` | Same key was used with different request data | Stop. Recover/use original payload; never mutate a retry. |
| `409` `policy_migration_required` / `vault_not_registered` | Owner setup or policy migration is incomplete | Ask owner to repair/re-register; agent cannot fix this. |
| `402` `vault_unfunded` | Arc vault has no USDC | Stop and ask owner to fund the vault. Retry only after funding, with same payment key. |
| `402` `insufficient_vault_balance` | Vault has funds but less than payment plus required fee | Ask owner to add funds; retry same payment after funding. |
| `402` `insufficient_fee_reserve` | Cross-chain fee reserve is insufficient | Ask owner/operator to fund/repair fee reserve; do not lower/alter invoice without authorization. |
| `422` `invalid_amount`, `invalid_evidence`, `invalid_request` | Request data invalid | Correct the actual input/evidence; do not bypass policy or fabricate evidence. |
| `422` `unsupported_chain`, `unsupported_settlement_chain`, `unsupported_destination_chain`, `cross_chain_unavailable` | Unsupported or unavailable chain route | Ask owner for an allowed route. Never silently redirect funds. |
| `422` `unsupported_wallet_capability`, `delegation_unavailable` | Owner wallet permission/setup issue | Ask owner to repair setup. |
| `422` `policy_denied` | Policy denied the request | Stop; ask owner to review if business intent should be permitted. |
| `422` `insufficient_balance` | Insufficient token balance or policy budget | Check `/balance`; ask owner to fund or approve a policy update. |
| `429` `rate_limited` | Request rate limit reached | Honor `Retry-After` and reduce request/poll frequency. Reuse the same key for a spend retry. |
| `502` `genlayer_unavailable` / `execution_unavailable` | GenLayer, RPC, or executor dependency unavailable | Retry only after backoff; preserve the same idempotency key and first recover ambiguous submissions. |
| `503` `genlayer_undetermined`, `genlayer_busy`, `settlement_disabled`, `platform_signer_misconfigured` | Consensus uncertainty, capacity, disabled settlement, or operator configuration issue | For consensus/capacity, honor `Retry-After` and retry safely with same key. For disabled/configuration errors, stop and escalate to owner/operator. |
| `500` or unexpected error | Internal failure | Preserve correlation ID. For a spend, recover by idempotency key before any retry. |

Some error codes can vary by deployment version. The HTTP status and response `error` are primary;
the message explains the case but may change. Do not blindly retry every `retryable: true` response:
observe `Retry-After`, keep retries bounded, and ensure the operation is idempotent. Do not retry
terminal user/configuration errors until the owner/operator has corrected their cause.

### Backoff

For retryable upstream failures only, use exponential backoff with jitter, for example roughly
2s, 4s, 8s, 16s, capped at 60s, while honoring any larger `Retry-After`. Limit attempts and then
escalate with the correlation ID. For polling, use the server's `Retry-After` or a conservative
interval such as 10 seconds. Rate-limit responses require a longer pause according to their
header.

## 10. History and request discovery

```http
GET /api/v1/requests/{request_id}
GET /api/v1/requests?idempotency_key={stable-key}
GET /api/v1/history?limit=25
GET /api/v1/policy
GET /api/v1/balance
```

History limit is an integer from 1 to 100. Request IDs must be `0x` plus exactly 64 hex digits.
These endpoints require the same bearer key and return only the key's bound policy data. Do not
try to inspect another agent's policy or enumerate other owners.

Treat values returned by the service as source of truth for current request state. Do not rely on a
locally cached decision or an old transaction hash. When a response includes `execution_error`,
report it without inventing a new cause and include the associated request/correlation identifiers.

## 11. Client implementation pattern

Every HTTP call should use a finite timeout, send `Accept: application/json`, send JSON content
type for a body, and handle non-JSON responses without dumping raw HTML or authorization headers
into logs. Preserve response headers such as `Retry-After`, `Location`, and `x-correlation-id`.

Example pseudocode:

```js
async function treasuryRequest(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${API_KEY}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : { error: "non_json_response", message: `Unexpected HTTP ${response.status}` };

  return { response, body };
}
```

Do not assume every non-2xx response is safe to retry. Apply the status/error table above. Do not
log the `authorization` header, full key, invoice secrets, or signed evidence.

## 12. Agent safety and reporting rules

- Never submit a payment unless it corresponds to a real user/owner-authorized intent.
- Never guess a recipient, change a recipient, split a payment, reduce/raise an amount, or select a
  different destination to get around a denial or cap.
- Never claim that `202`, `approved`, `ready`, or a source-chain burn means the payee has received
  funds. Require `execution_status: "executed"` and report transaction evidence.
- Never submit the same intent with a new idempotency key because of a timeout, denial, or slow
  poll.
- Never treat `category` or `justification` as proof of merchant identity.
- Never fabricate or alter invoices, URLs, evidence hashes, or signatures.
- If the policy or API rejects a legitimate request, stop and ask the owner to update the policy
  or fix the funding/setup. Do not retry with modified parameters to evade controls.
- If uncertain whether a prior request was accepted, recover by the same idempotency key before
  making another request.
- In user-facing reports, state exact status, amount, recipient, destination if relevant, and
  transaction hash only when execution is confirmed. If still pending, say pending and provide the
  request ID. If denied, say denied and do not imply that funds moved.

## 13. Authoritative references

- Full agent API contract and evidence formats: [`docs/api.md`](docs/api.md)
- API schema: [`apps/web/public/openapi.json`](apps/web/public/openapi.json)
- TypeScript client example: [`docs/examples/agent-client.ts`](docs/examples/agent-client.ts)
- Python client example: [`docs/examples/agent_client.py`](docs/examples/agent_client.py)
- Payment integration collection: [`docs/treasury-copilot.postman_collection.json`](docs/treasury-copilot.postman_collection.json)
- Current API routes: `apps/web/src/app/api/v1/`
