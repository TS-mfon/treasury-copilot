# Treasury Copilot Agent API

This is the normative HTTP contract for agents. Agents use JSON over HTTPS and a bearer API key. They do not install `genlayer-js`, MetaMask, viem, or an EVM wallet library.

## 0. Five-minute quickstart

You need two values from the human owner:

```bash
export TREASURY_API_KEY="tcp_..."
export AGENT_ADDRESS="0xYourRegisteredAgentAddress"
export TREASURY_API_BASE="https://treasury-copilot-genjury.vercel.app/api/v1"
```

The key is bound to exactly one owner, agent, GenLayer policy, delegated
account, chain, and token. It cannot be reused for another treasury.

Verify the binding and available balance:

```bash
curl -sS "$TREASURY_API_BASE/balance" \
  -H "Authorization: Bearer $TREASURY_API_KEY" \
  -H "Accept: application/json"
```

Submit a request with a stable idempotency key:

```bash
curl -sS "$TREASURY_API_BASE/spend" \
  -H "Authorization: Bearer $TREASURY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{
    \"agent_address\": \"$AGENT_ADDRESS\",
    \"recipient\": \"0xRecipientAddress\",
    \"amount\": \"2.50\",
    \"category\": \"api_subscription\",
    \"justification\": \"Monthly model API invoice INV-4471\",
    \"idempotency_key\": \"invoice-4471-2026-07\"
  }"
```

Save the returned `request_id`. After an ambiguous timeout, retry with the same
idempotency key or poll `GET /requests/:request_id`. Never create a new
idempotency key for the same intended payment.

## 1. Connection

```text
https://treasury-copilot-genjury.vercel.app/api/v1
```

All requests use:

```http
Authorization: Bearer tcp_<payload>.<signature>
Content-Type: application/json
Accept: application/json
```

Do not send the key in a URL, query string, log line, or user-visible prompt. The setup page shows each key once. Owners rotate keys from the authenticated dashboard.

### Who signs transactions

The API key authenticates and identifies the agent, but it never signs a
GenLayer transaction. Every state-changing GenLayer call is signed server-side
by the configured platform signer. Before a write, the server verifies the key,
body `agent_address`, active registry binding, policy funding fields, and that
the policy `execution_reporter` equals the current platform signer.

GenLayer independently checks the transaction sender, agent attribution,
registry binding, limits, whitelist, policy text, deadline, and replay state.
The agent never receives the platform private key or MetaMask delegation data.

## 2. API key issuance

An API key is not created when MetaMask grants the ERC-7715 permission. The permission is only the funding authorization. Key issuance happens after the owner clicks **Register delegation** and every setup stage succeeds:

1. Verify the authenticated owner session.
2. Verify the fresh EIP-712 setup authorization.
3. Validate that the MetaMask grant exactly matches owner, platform delegate, chain, token, weekly amount, and permission context.
4. Deploy or update the agent's GenLayer policy.
5. Register the owner-agent-policy-funding binding in `TreasuryRegistry`.
6. Store the serialized delegation and permission context in the policy.
7. Read the policy and registry back from GenLayer and verify the stored values.
8. Generate a fresh UUID key ID and issue the signed `tcp_` bearer credential.

If any contract deployment, registration, finality, execution, or readback check fails, the endpoint returns an error and does not issue a key.

Successful setup returns:

```json
{
  "agent_api_key": "tcp_<payload>.<signature>",
  "agent": "0x...",
  "owner": "0x...",
  "policy": "0x...",
  "chain_id": 84532,
  "chain": "Base Sepolia",
  "token_symbol": "USDC",
  "token_decimals": 6,
  "deployment_tx_hash": "0x...",
  "delegation_tx_hash": "0x...",
  "delegation_registered": true
}
```

The setup page displays `agent_api_key` once. A new agent/policy setup receives a distinct key. Rotating a key increments the registry's on-chain `api_key_version` and issues another unique key ID; all keys with the previous version then fail registry validation. Revoking a key deactivates the policy binding and issues no replacement.

Treat the entire `tcp_` value as a secret bearer credential. Its payload is signed for integrity, not encrypted.

## 3. Binding model

The key claims are:

```json
{
  "type": "agent",
  "version": 1,
  "keyId": "uuid",
  "keyVersion": 1,
  "owner": "0x...",
  "agent": "0x...",
  "policy": "0x...",
  "delegatedAccount": "0x...",
  "chainId": 84532,
  "token": "0x...",
  "tokenSymbol": "USDC",
  "tokenDecimals": 6,
  "issuedAt": 0
}
```

The server verifies the HMAC signature and then reads the registry. A key is rejected if any of these differ from active on-chain data:

- policy;
- owner;
- agent;
- delegated account;
- chain;
- token address;
- token symbol;
- token decimals;
- API-key version;
- active flag.

The request body must also include `agent_address`, and it must match both the key and registry.

## 4. Spend request

### Request

```http
POST /api/v1/spend
```

```json
{
  "agent_address": "0x1111111111111111111111111111111111111111",
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "25.000000",
  "category": "software",
  "justification": "Production API renewal invoice INV-4471",
  "idempotency_key": "invoice-4471-2026-07"
}
```

Field rules:

| Field | Required | Rule |
| --- | --- | --- |
| `agent_address` | yes | Registered EVM address |
| `recipient` | yes | EVM address |
| `amount` | yes | Positive decimal string, USDC precision |
| `category` | yes | 2-64 characters |
| `justification` | yes | 4-1200 characters |
| `idempotency_key` | no | 8-128 safe characters |
| `request_id` | no | 32-byte hex ID for advanced integrations |

`amount: "25.000000"` becomes `amount_units: "25000000"`. `25`, `25.0`, and `25.000000` represent the same amount. `25.0000001`, `1e2`, `-1`, `0`, and JSON numeric values are rejected.

### Response

```json
{
  "request_id": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "verdict": "approved",
  "reasoning": "The request matches the exact recipient and policy",
  "request": {
    "request_id": "0x...",
    "recipient": "0x...",
    "amount": "25",
    "amount_units": "25000000",
    "category": "software",
    "justification": "Production API renewal invoice INV-4471",
    "verdict": "approved",
    "decision_mode": "prompt_comparative",
    "status": "executed",
    "execution_status": "executed",
    "execution_error": "",
    "tx_hash": "0x...",
    "explorer_url": "https://sepolia.basescan.org/tx/0x...",
    "created_at": "2026-07-21T12:00:00.000Z",
    "updated_at": "2026-07-21T12:01:00.000Z"
  },
  "chain": {
    "chain_id": 84532,
    "name": "Base Sepolia",
    "explorer_url": "https://sepolia.basescan.org"
  },
  "idempotent_replay": false,
  "execution": {
    "mode": "erc7710",
    "task_id": "relayer-task-id",
    "fee_amount": "0.01",
    "fee_amount_units": "10000"
  },
  "genlayer": {
    "request_tx_hash": "0x...",
    "record_execution_tx_hash": "0x..."
  }
}
```

The API waits for GenLayer finality before returning a verdict. An approved request may still have `execution_status: "failed"` when 1Shot is temporarily unavailable. That request remains retryable and visible in history.

The HTTP response can still be `200` when policy evaluation succeeded but
payout execution failed. Inspect `request.execution_status` and
`request.execution_error`. Do not create a replacement request; the retry worker
uses the same on-chain request ID.

`idempotent_replay: true` means the API returned an existing on-chain request.
No new GenLayer request or payout was submitted. The original request ID and
Base transaction hash remain in `request`.

`decision_mode` values:

| Value | Meaning |
| --- | --- |
| `deterministic` | A cap, budget, amount, or whitelist rule decided the request |
| `prompt_comparative` | GenLayer prompt-comparative consensus evaluated the policy |
| `legacy_fast_approval` | A V2 policy skipped semantic review because the amount was below its limit |

Treat `legacy_fast_approval` as a migration warning. Policy V3 requires a zero
fast-approval limit and sends every request through prompt-comparative review.

## 5. Idempotency

Use an idempotency key for invoices, subscriptions, and any operation that may be retried by a network client.

The server derives a request ID from policy, key ID, and idempotency key. On repeat:

- same key and identical recipient/amount/category/justification: return the existing on-chain request;
- same key with any changed field: return `idempotency_conflict`;
- no key: generate a random request ID.

Idempotency is not a replacement for on-chain replay protection. The policy always rejects a duplicate request ID.

## 6. Balance

```http
GET /api/v1/balance
```

Example:

```json
{
  "owner": "0x...",
  "agent": "0x...",
  "policy": "0x...",
  "delegated_account": "0x...",
  "chain_id": 84532,
  "chain": {
    "chain_id": 84532,
    "name": "Base Sepolia",
    "explorer_url": "https://sepolia.basescan.org"
  },
  "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "token_symbol": "USDC",
  "token_decimals": 6,
  "balance": "412.35",
  "balance_units": "412350000",
  "weekly_spent": "50",
  "weekly_spent_units": "50000000",
  "weekly_cap": "100",
  "weekly_cap_units": "100000000",
  "weekly_available": "50",
  "per_tx_cap": "25",
  "per_tx_cap_units": "25000000",
  "security": {
    "contract_version": "3",
    "semantic_review_required_for_all_requests": true,
    "legacy_fast_approval_active": false,
    "warnings": []
  }
}
```

The balance is read from the delegated account's ERC-20 balance. It is not an
authorization decision; the policy caps and active registry binding remain
authoritative. `weekly_available` is policy budget remaining and currently
excludes the 1Shot fee.

## 7. Merchant identity and evidence

`category` and `justification` are untrusted agent claims. They do not prove
that a recipient belongs to a merchant or that an invoice is genuine.

For the current API:

- include the exact permitted recipient address in the policy text;
- enable the recipient whitelist;
- include a specific invoice or billing reference in the justification;
- set every legacy V2 fast-approval limit to `0`;
- do not rely on a merchant name alone.

Evidence-backed invoice, domain, and signature verification is planned for API
V2. Until that exists, a rule such as "pay Vercel only" without an exact
recipient binding is not sufficient for production funds.

## 8. History

```http
GET /api/v1/history?limit=50
GET /api/v1/requests/:request_id
GET /api/v1/policy
```

History is pulled from GenLayer state. The service does not maintain a separate mutable database as the source of truth.

`limit` must be an integer from `1` to `100`. Request IDs must be `0x` followed
by exactly 64 hexadecimal characters.

`GET /policy` returns safe policy metadata, caps, budget usage, policy text, and
whether a delegation is registered. It deliberately omits the serialized
delegation, permission context, signatures, and platform private-key material.

Status meanings:

| Status | Meaning |
| --- | --- |
| `denied` | Policy or cap rejected the request |
| `approved` | Finalized approval is ready for execution |
| `executing` | Execution lease is held by the platform worker |
| `failed` | Relay failed; retry is allowed after lease release |
| `executed` | EVM tx hash recorded on-chain |

## 9. Errors

Every error has:

```json
{
  "error": "invalid_amount",
  "message": "Amount has too many decimal places for this asset",
  "fields": {},
  "request_id": "optional",
  "retryable": false
}
```

Clients should branch on `error`, not on human message text.

| Error | HTTP | Retry |
| --- | ---: | --- |
| `invalid_api_key` | 401 | no |
| `unauthorized` | 401 | no |
| `agent_mismatch` | 403 | no |
| `policy_inactive` | 403 | owner action |
| `request_not_found` | 404 | check ID |
| `idempotency_conflict` | 409 | no |
| `invalid_amount` | 422 | no |
| `invalid_request` | 422 | fix payload |
| `unsupported_chain` | 422 | no |
| `unsupported_wallet_capability` | 422 | owner action |
| `policy_denied` | 422 | no |
| `insufficient_balance` | 422 | after funding |
| `genlayer_undetermined` | 503 | yes |
| `genlayer_unavailable` | 502 | yes |
| `execution_unavailable` | 502 | yes |
| `platform_signer_misconfigured` | 503 | operator action |
| `delegation_unavailable` | 422 | after setup repair |
| `request_failed` | 400/500 | inspect state |

### Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `invalid_api_key` | Missing, malformed, expired, rotated, or incorrectly signed key | Ask the owner to rotate and issue a new key |
| `agent_mismatch` | Body address differs from the key's registered agent | Use the exact `agent` returned by `/balance` |
| `policy_inactive` | Owner revoked the agent or policy | Owner must reactivate or reconfigure the agent |
| `idempotency_conflict` | One key was reused with different payment details | Use the original payload or a new key for a different payment |
| `genlayer_unavailable` | Submission, RPC, finality, or GenVM infrastructure failed | Retry the same idempotency key after backoff |
| `execution_unavailable` | GenLayer approved, but 1Shot could not execute | Poll the same request; do not submit a duplicate |
| `platform_signer_misconfigured` | Server signer is missing, malformed, or differs from the policy reporter | Operator must repair deployment configuration |

Retry only `502` and `503` responses automatically. Use exponential backoff
with jitter and always reuse the same `idempotency_key`. After an ambiguous
timeout, query history or the request endpoint before another POST.

## 10. Minimal clients

```bash
curl -sS "$BASE/api/v1/balance" \
  -H "Authorization: Bearer $TREASURY_API_KEY"
```

```bash
curl -sS "$BASE/api/v1/spend" \
  -H "Authorization: Bearer $TREASURY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_address": "0x1111111111111111111111111111111111111111",
    "recipient": "0x2222222222222222222222222222222222222222",
    "amount": "2.50",
    "category": "software",
    "justification": "Monthly build service invoice",
    "idempotency_key": "build-2026-07"
  }'
```

```js
const response = await fetch(`${base}/api/v1/spend`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.TREASURY_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    agent_address: process.env.AGENT_ADDRESS,
    recipient,
    amount: "2.50",
    category: "software",
    justification: "Monthly build service invoice",
    idempotency_key: "build-2026-07",
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(`${result.error}: ${result.message}`);
```

## 11. Security rules for agent developers

- Store the API key in a secret manager or environment variable.
- Never place it in source control, browser code, URLs, analytics, or prompts.
- Never trust the decoded key payload without calling the API; registry state
  and key version can change after issuance.
- Do not log complete request or response headers.
- Use a unique idempotency key for each real-world invoice or payment intent.
- Validate the recipient independently before submitting.
- Rotate the key immediately after accidental disclosure.
- Treat `tx_hash` as authoritative only when `execution_status` is `executed`.
- Treat `category` and `justification` as descriptions, not merchant evidence.
- Reject or escalate policies whose `security.warnings` array is non-empty.

## 12. Verified live behavior

The July 26, 2026 Base Sepolia test verified policy denial,
prompt-comparative approval, 1Shot execution, EVM receipt success, GenLayer
transaction-hash recording, history retrieval, and idempotent replay with no
duplicate payment. It also exposed the merchant-identity and legacy
fast-approval issues above. See
[the live policy test report](live-policy-test-2026-07-26.md).
