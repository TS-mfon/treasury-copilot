# Treasury Copilot — Agent API Reference

This file is the canonical endpoint-by-endpoint reference for building or reviewing agent integrations. For product overview and trust model, see `README.md`. For in-app developer docs, see `/docs`.

## Base path

`https://YOUR_DOMAIN/api/v1`

## Auth

Send `Authorization: Bearer tc_***`. The key is issued once during owner setup and encodes owner, agent, policy, chain, token, decimals, and version. Every request validates the key, the submitted `agent_address`, the on-chain registry binding, and the active policy state.

## Endpoints

### POST /api/v1/spend

Submit one spend request.

**Request**
```json
{
  "agent_address": "0xYourRegisteredAgent",
  "recipient": "0xRecipient",
  "amount": "25.00",
  "category": "api_subscription",
  "justification": "Monthly API invoice INV-4471",
  "idempotency_key": "billing-4471-2026-07"
}
```

**Success response**
```json
{
  "request_id": "0x...",
  "agent": "0x...",
  "recipient": "0x...",
  "amount": "25.00",
  "amount_units": "25000000",
  "token_decimals": 6,
  "status": "approved",
  "verdict": "approved",
  "reasoning": "Within auto-approve threshold.",
  "tx_hash": "0x...",
  "explorer_url": "https://basescan.org/tx/0x...",
  "created_at": "2026-07-16T22:10:00.000Z",
  "updated_at": "2026-07-16T22:10:00.000Z"
}
```

**Error response**
```json
{
  "error": "insufficient_balance",
  "message": "Delegated balance is below the requested amount",
  "fields": { "amount": ["requested 25.00 USDC, available 4.20 USDC"] },
  "request_id": "abc-123"
}
```

**Notes**
- `amount` is a decimal string; never a float.
- Duplicate spend digests return the existing request instead of creating a second spend.
- `status` values: `pending`, `approved`, `denied`, `executing`, `executed`, `execution_failed`.

### GET /api/v1/balance

Return delegated balance, weekly spend, cap data, and metadata for the current API key binding.

**Response**
```json
{
  "owner": "0x...",
  "agent": "0x...",
  "policy": "0x...",
  "delegated_account": "0x...",
  "chain_id": 84532,
  "token": "0x...",
  "token_symbol": "USDC",
  "token_decimals": 6,
  "balance": "412.35",
  "balance_units": "412350000",
  "weekly_spent": "50.00",
  "weekly_spent_units": "50000000",
  "weekly_cap": "100.00",
  "weekly_cap_units": "100000000",
  "per_tx_cap": "25.00",
  "per_tx_cap_units": "25000000"
}
```

### GET /api/v1/history?limit=50

Return on-chain request records for the API key binding.

**Response**
```json
[
  {
    "request_id": "0x...",
    "recipient": "0x...",
    "amount": "9.50",
    "amount_units": "9500000",
    "category": "api_subscription",
    "justification": "Invoice #7782",
    "status": "approved",
    "verdict": "approved",
    "reasoning": "Within threshold.",
    "tx_hash": "0x...",
    "explorer_url": "https://basescan.org/tx/0x...",
    "created_at": "2026-07-16T22:00:00.000Z",
    "updated_at": "2026-07-16T22:00:30.000Z"
  }
]
```

### GET /api/v1/requests/:id

Return one request by ID. The caller only sees requests matched to their API key.

**Response**
```json
{
  "policy": "0x...",
  "request": {
    "request_id": "0x...",
    "agent": "0x...",
    "recipient": "0x...",
    "amount": "9.50",
    "amount_display": "9.50",
    "token_decimals": 6,
    "status": "approved",
    "tx_hash": "0x...",
    "explorer_url": "https://basescan.org/tx/0x..."
  }
}
```

## Decimal handling

Amounts must be decimal strings with precision bounded by token decimals. The server converts to raw integer units and returns both formats. Never use JavaScript `Number`/`parseFloat` for financial amounts.

## Idempotency

Use `idempotency_key` when possible. If the same spend digest is seen twice, the server returns the existing request with no duplicate payout.

## Chain support

Active: Base Sepolia, Arbitrum Sepolia. Explorer links are auto-derived from the API key binding.

X Layer is not supported in the current product surface. Revisit only after 1Shot capability testing passes.

## Security

- Always validate `agent_address` against API claims and registry data.
- Treat API keys as credentials; do not log or expose them in URLs.
- Owner-facing UI uses `httpOnly` wallet sessions and on-chain ownership checks; no agent API key input is accepted.

Recoverable errors include unsupported wallet RPC, missing capability, insufficient token balance, rejected signing, relayer estimates, reverted transactions, and policy denials.
