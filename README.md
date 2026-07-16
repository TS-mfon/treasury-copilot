# Treasury Copilot

Treasury Copilot gives an AI agent bounded spending power without giving it a private key. An owner configures one isolated treasury policy for each agent; the agent sends ordinary HTTPS JSON with an API key; the platform signer creates the GenLayer request and evaluation; only approved requests are executed automatically through 1Shot. Every lifecycle event—request, verdict, execution result, and EVM transaction hash—remains on-chain for full auditability.

This README is the developer and operator reference. Deep endpoint schemas live in-app under `/docs`, and this file describes the product model, trust boundaries, funding rails, API, chain support, environment, deployment, and troubleshooting.

## Trust model

The owner controls the policy, API-key lifecycle, funding source, and delegation revocation. The agent cannot modify policy, choose another owner’s funds, or sign blockchain transactions. The platform signer is server-only and performs EIP-712 signing plus GenLayer writes; it never receives custody of funds. GenLayer stores the approval decision and execution lifecycle. The owner’s funding source pays the executor for a valid, approved payout request.

Each binding is `owner + agent wallet + GenLayer policy + chain + asset + funding source`. API claims, submitted `agent_address`, registry state, policy state, delegated account, and asset metadata must all match before any request is accepted or executed. The platform signer/policy/delegation internals are never surfaced in normal UI flows.

## Funding rails

- **ERC-7715 delegation:** owner grants USDC execution permission to the platform executor. Setup checks wallet capability before calling `wallet_requestExecutionPermissions`, stores the delegation context on GenLayer, and lets 1Shot redeem approved payouts.
- **Owner-controlled vault:** a per-agent EVM treasury. The owner deposits an exact amount and can withdraw; only the relayer can execute a unique approved request ID. This is the fallback for unsupported wallets.
- **Native OKB:** not currently exposed. X Layer support is deferred pending 1Shot capability retesting.

Approved 1Shot executions use gas abstraction and can be paid from USDC. Owners only need native gas for optional wallet setup transactions where their wallet requires it.

## Agent API

All endpoints are under `/api/v1`. Send `Authorization: Bearer ***`. API keys are shown once during owner setup. The agent never needs a wallet library, private key, gas, or GenLayer SDK.

### POST /api/v1/spend

Submits one spend request. GenLayer evaluates it. Approved requests are claimed, sent to 1Shot, and the resulting EVM transaction hash is written back on-chain.

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

**Rules**
- `agent_address` must match the API key claim and the active registry binding.
- `amount` is a positive decimal string. JavaScript floating-point numbers are not accepted.
- `idempotency_key` is optional but recommended. Reusing an identical spend digest returns the existing request instead of creating a duplicate.
- Server converts using the configured token decimals. Responses return both display and raw integer units.

**Response**
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

### GET /api/v1/balance

Returns the current delegated balance, token metadata, weekly spent, weekly cap, and per-request cap for the authenticated API key binding.

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

Returns GenLayer request records for the current key binding.

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

Returns one request by ID, scoped to the authenticated API key.

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

## Request lifecycle

1. Agent sends `POST /api/v1/spend`.
2. Auth validates API key, required `agent_address`, registry binding, and policy bounds.
3. Backend creates/records the GenLayer request and returns `pending`, `approved`, or `denied`.
4. The platform relay worker claims approved requests, builds a 1Shot transaction, confirms EVM execution, and writes `tx_hash` back on-chain.
5. History and request endpoints expose lifecycle data from on-chain records. Failed relays remain visible for retry with no duplicate payout.

## Amounts and decimals

Always send amounts as decimal strings, never floats. The server converts with the token’s configured decimal count. Responses always include both the human-readable display amount and the raw integer units. Reusing a request ID is rejected or returned idempotently.

## Errors

All agent endpoints return JSON with stable top-level fields and machine-readable details.

```json
{
  "error": "insufficient_balance",
  "message": "Delegated balance is below the requested amount",
  "fields": { "amount": ["requested 25.00 USDC, available 4.20 USDC"] },
  "request_id": "abc-123"
}
```

Common error codes:
- `invalid_api_key`: missing, expired, or revoked key
- `agent_mismatch`: mismatched `agent_address` or registry binding
- `insufficient_balance`: delegated amount below requested value
- `invalid_amount`: negative, malformed, or too many decimals
- `policy_denied`: approval threshold, cap, or whitelist blocked it
- `unsupported_wallet_capability`: ERC-7715 not available in owner wallet
- `chain_capability_missing`: 1Shot cannot execute on requested chain
- `duplicate_request`: identical spend digest already recorded

## Owner application

Connect and unlock the owner wallet to create an `httpOnly` signed session. Dashboard, History, Policy, and agent-management pages use that session plus on-chain registry ownership; they never accept an agent API key through the UI. Owners can configure one policy per agent, rotate/revoke keys, update future policy limits, and review the complete on-chain audit trail.

The platform signer, GenLayer policy address, delegation payload, and low-level relay parameters are not presented in ordinary owner flows.

## Networks

GenLayer Studionet is the policy/evaluation network. Supported EVM execution chains: Base Sepolia and Arbitrum Sepolia. X Layer mainnet/testnet is explicitly not exposed in the UI until 1Shot capability is retested and gated.

Configure token addresses with environment variables; do not hard-code unverified asset contracts into deployment artifacts.

## Development

Copy `.env.example` to `.env.local`, then set the server-only signer and secrets. Never expose `AGENT_SIGNER_PRIVATE_KEY`, `AGENT_API_KEY_SECRET`, or `OWNER_SESSION_SECRET` with a `NEXT_PUBLIC_` prefix.

```bash
npm install
npm run typecheck -w apps/web --if-present
npm run build -w apps/web
npm run lint -w apps/web --if-present
forge test --root contracts/evm
genvm-lint check contracts/genlayer/TreasuryPolicy.py
genvm-lint check contracts/genlayer/TreasuryRegistry.py
```

Deploy fresh GenLayer policy/registry versions after contract interface changes. The existing deployed single-policy addresses are not a substitute for the per-agent registry required by this product.

## Legacy API notice

The legacy `/api/submit-agent-request` path remains present for transitional compatibility. It does not return the validated `/api/v1` response shape and will be removed once callers migrate. Use `/api/v1/spend`, `/api/v1/balance`, `/api/v1/history`, `/api/v1/policy`, and `/api/v1/requests/:id`.
