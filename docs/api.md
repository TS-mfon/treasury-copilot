# Treasury Copilot Agent API

This is the normative HTTP contract for agents. Agents use JSON over HTTPS and a bearer API key. They do not install `genlayer-js`, MetaMask, viem, or an EVM wallet library.

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
  "reasoning": "Within auto-approve threshold",
  "request": {
    "request_id": "0x...",
    "recipient": "0x...",
    "amount": "25",
    "amount_units": "25000000",
    "category": "software",
    "justification": "Production API renewal invoice INV-4471",
    "verdict": "approved",
    "status": "executed",
    "execution_status": "executed",
    "execution_error": "",
    "tx_hash": "0x...",
    "explorer_url": "https://sepolia.basescan.org/tx/0x...",
    "created_at": "2026-07-21T12:00:00.000Z",
    "updated_at": "2026-07-21T12:01:00.000Z"
  },
  "genlayer": {
    "request_tx_hash": "0x...",
    "record_execution_tx_hash": "0x..."
  }
}
```

The API waits for GenLayer finality before returning a verdict. An approved request may still have `execution_status: "failed"` when 1Shot is temporarily unavailable. That request remains retryable and visible in history.

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
  "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "token_symbol": "USDC",
  "token_decimals": 6,
  "balance": "412.35",
  "balance_units": "412350000",
  "weekly_spent": "50",
  "weekly_spent_units": "50000000",
  "weekly_cap": "100",
  "weekly_cap_units": "100000000",
  "per_tx_cap": "25",
  "per_tx_cap_units": "25000000"
}
```

The balance is read from the delegated account’s ERC-20 balance. It is not an authorization decision; the policy caps and active registry binding remain authoritative.

## 7. History

```http
GET /api/v1/history?limit=50
GET /api/v1/requests/:request_id
GET /api/v1/policy
```

History is pulled from GenLayer state. The service does not maintain a separate mutable database as the source of truth.

Status meanings:

| Status | Meaning |
| --- | --- |
| `denied` | Policy or cap rejected the request |
| `approved` | Finalized approval is ready for execution |
| `executing` | Execution lease is held by the platform worker |
| `failed` | Relay failed; retry is allowed after lease release |
| `executed` | EVM tx hash recorded on-chain |

## 8. Errors

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
| `idempotency_conflict` | 409 | no |
| `invalid_amount` | 422 | no |
| `unsupported_chain` | 422 | no |
| `unsupported_wallet_capability` | 422 | owner action |
| `policy_denied` | 422 | no |
| `insufficient_balance` | 422 | after funding |
| `genlayer_undetermined` | 503 | yes |
| `delegation_unavailable` | 422 | after setup repair |
| `request_failed` | 400/500 | inspect state |

## 9. Minimal clients

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
