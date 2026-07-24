# Treasury Copilot

Treasury Copilot gives an autonomous agent bounded spending power without giving the agent a private key. A human connects a wallet, grants a time-bounded ERC-7715 USDC permission to the platform executor, and configures one GenLayer policy per agent. The agent then sends ordinary HTTPS JSON with an API key. The platform signer submits the request to GenLayer, GenLayer reaches consensus on the policy decision, and only finalized approvals may be redeemed through 1Shot.

The product is intentionally split into two trust domains:

- **Human domain:** wallet login, delegation, policy configuration, key rotation, revocation, and audit review.
- **Agent domain:** HTTP API key, JSON spend requests, status polling, and on-chain history.

The agent never signs EIP-712 data, invokes GenLayer directly, manages gas, or receives custody of the human’s funds.

## Status

The current release targets:

- GenLayer StudioNet for policy deployment and evaluation.
- Base Sepolia for delegated USDC execution.
- Base Mainnet is visible in setup but delegation is disabled until 1Shot advertises chain `8453`.
- ERC-7715 periodic ERC-20 delegation only.
- Sequenced MetaMask chain confirmation and capability diagnostics before permission requests.
- 1Shot ERC-7710 redemption after GenLayer finality.
- On-chain request history, execution state, and EVM transaction hash recording.

X Layer mainnet (`196`), X Layer testnet (`1952`), native OKB, and other execution chains remain configuration capabilities but are hidden from setup until a live 1Shot capability check confirms they can safely execute the selected asset. No unsupported chain is allowed to create a delegation.

There is no vault fallback in this release. Unsupported ERC-7715 wallets receive an actionable setup error and no funds are moved.

## Architecture

### On-chain contracts

`TreasuryRegistry.py` is the deterministic registry. It stores the binding:

```text
owner + agent + policy + chain + token + delegated account
```

It also stores the per-owner registration nonce and API-key version. The registry gateway is the platform GenLayer account. Owner wallet signatures are checked by the server before a gateway write is submitted.

`TreasuryPolicy.py` is one policy contract per owner/agent funding binding. It stores:

- owner and authorized agent;
- platform execution reporter;
- delegated account and token;
- delegation context and serialized delegation;
- per-request cap, weekly cap, and auto-approval threshold;
- recipient whitelist;
- weekly reservation accounting;
- request verdict, reasoning, timestamps, finality marker, execution lease, failure, and transaction hash.

The policy verifies:

1. The GenLayer transaction sender is the configured platform account.
2. The `on_behalf_of` agent address.
3. The active registry binding.
4. Request deadline and signed justification hash.
5. Recipient, category, justification, amount, cap, whitelist, and replay rules.

### Server

The Next.js server is the only component that holds the platform private key. It:

1. Verifies the agent API key.
2. Loads the registry and policy from GenLayer.
3. Compares every API claim with on-chain binding data.
4. Converts display amounts using exact integer units.
5. Signs and submits the GenLayer transaction as the platform account.
6. Waits for the policy call to reach `FINALIZED`.
7. Marks the request finalized on-chain.
8. Attempts 1Shot execution for approved requests.
9. Records success or failure on-chain.

The cron endpoint is a retry mechanism for requests left in `ready` or `failed` execution states. It is not the source of truth.

### 1Shot

The server reads current relayer capabilities and fee data. It rejects unsupported chains, missing target addresses, missing fee collectors, invalid delegation context, invalid token data, and malformed relayer results. For ERC-7710 execution it:

1. Redelegates the stored MetaMask permission context to the current 1Shot target.
2. Builds the fee transfer and recipient transfer.
3. Estimates the fee in the delegated token.
4. Sends the ERC-7710 bundle.
5. Polls until a confirmed transaction hash exists.
6. Records that hash in GenLayer.

No public HTTP route accepts arbitrary recipient/amount/delegation payout payloads. The old unsafe execution route was removed. The standalone relay worker only triggers the authenticated cron endpoint.

## Human setup

1. Open `/setup`.
2. Connect the owner wallet.
3. Select Base Sepolia. Base Mainnet remains unavailable while 1Shot returns no capability for chain `8453`.
4. Treasury Copilot switches MetaMask and confirms `eth_chainId` is `0x14a34`.
5. Treasury Copilot logs `wallet_getCapabilities` for the connected account and chain. This EIP-5792 diagnostic does not replace the ERC-7715 request because MetaMask does not standardize a `permissions.supported` field in that response.
6. Enter the agent wallet address and weekly delegated USDC amount.
7. Approve the direct `wallet_requestExecutionPermissions` request. This follows Siggy Treasury's extended viem wallet-client pattern and does not require an `eth_getCode` or EIP-7702 precheck.
8. Keep native ETH available for wallet setup or upgrade transactions. The owner may need native gas even though approved 1Shot payouts use delegated USDC.
9. Configure caps, threshold, policy text, and optional whitelist.
10. Sign the owner setup intent.
11. The platform deploys or resumes the matching policy, validates the exact returned grant, registers it on GenLayer, reads it back, and issues an API key.
12. Copy the API key immediately. It is shown once.

Failures are tagged by step in the browser console and UI: `chain-switch`, `capability-check`, or `permission-request`. A missing diagnostic `wallet_getCapabilities` method does not block the proven direct ERC-7715 request; a missing `wallet_requestExecutionPermissions` method does.

The setup intent is bound to owner, agent, policy placeholder, chain, token, delegation payload, caps, whitelist, policy text, nonce, and deadline. Delegation payload object keys are canonically sorted before hashing so browser and server representations cannot drift.

## Agent API

Base URL:

```text
https://YOUR_DOMAIN/api/v1
```

Authentication:

```http
Authorization: Bearer tcp_<signed-payload>.<signature>
Content-Type: application/json
```

The API key is an opaque signed credential. It contains immutable claims for owner, agent, policy, delegated account, chain, token, decimals, key ID, and key version. It is not a substitute for on-chain verification. Every API request rechecks the current registry and policy state.

### POST `/api/v1/spend`

Request:

```json
{
  "agent_address": "0xRegisteredAgent",
  "recipient": "0xRecipient",
  "amount": "25.00",
  "category": "api_subscription",
  "justification": "Monthly API invoice INV-4471",
  "idempotency_key": "billing-4471-2026-07"
}
```

Rules:

- `agent_address`, `recipient`, and all addresses must be valid EVM addresses.
- `amount` must be a positive decimal string. Floats, exponent notation, signs, and excess precision are rejected.
- USDC currently uses 6 decimals. The server returns raw integer units as well as display values.
- `category` is 2-64 characters.
- `justification` is 4-1200 characters.
- `idempotency_key` is optional, 8-128 characters, and restricted to letters, digits, `.`, `_`, `:`, and `-`.
- Reusing an idempotency key with the same payload returns the recorded request.
- Reusing it with a different payload returns a conflict.

The request route waits for GenLayer finality. Approved requests immediately attempt execution; the cron worker retries failures. A normal successful response includes:

```json
{
  "request_id": "0x...",
  "verdict": "approved",
  "request": {
    "status": "executed",
    "amount": "25",
    "amount_units": "25000000",
    "execution_status": "executed",
    "tx_hash": "0x...",
    "explorer_url": "https://sepolia.basescan.org/tx/0x..."
  },
  "genlayer": {
    "request_tx_hash": "0x...",
    "record_execution_tx_hash": "0x..."
  }
}
```

When a request is approved but 1Shot is temporarily unavailable, the response remains an on-chain approved request with `execution_status: "failed"` and an `execution_error`. It can be retried without creating a second payout.

### GET `/api/v1/balance`

Returns owner, agent, policy, delegated account, token metadata, current delegated token balance, weekly reservation, weekly cap, and per-request cap. Every monetary value has both a display field and an `_units` integer field.

### GET `/api/v1/history?limit=50`

Returns the current API key binding’s on-chain request history. Results include request ID, amount, category, justification, verdict, reasoning, finality, execution status, execution error, timestamps, transaction hash, and explorer URL.

### GET `/api/v1/requests/:id`

Returns one request only if it belongs to the API key’s current policy binding. Use this endpoint to poll a request after a timeout or relay failure.

### GET `/api/v1/policy`

Returns the current policy state for the API key’s binding. It is read-only for agents.

## Error contract

Errors use this shape:

```json
{
  "error": "agent_mismatch",
  "message": "Request agent does not match API key",
  "fields": {},
  "request_id": "optional-request-id",
  "retryable": false
}
```

Important codes:

| Code | Meaning | Retry |
| --- | --- | --- |
| `invalid_api_key` | Missing, malformed, expired, or invalid signature | No |
| `agent_mismatch` | Payload agent differs from key or registry | No |
| `idempotency_conflict` | Same key used with different payload | No |
| `invalid_amount` | Invalid decimal or precision | No |
| `unsupported_chain` | Chain is not enabled for this release | No |
| `unsupported_wallet_capability` | Owner wallet lacks ERC-7715 capability | No, change wallet |
| `delegation_unavailable` | Delegation is absent or invalid | After setup repair |
| `policy_denied` | Caps, whitelist, or policy evaluation denied request | No |
| `genlayer_undetermined` | Consensus did not finalize | Yes |
| `insufficient_balance` | Delegated token balance is insufficient | After funding |
| `request_failed` | Recoverable server, relay, or contract error | Inspect request |

## Owner authentication

Wallet login is nonce-based:

1. `/api/auth/nonce` issues a five-minute nonce in an HTTP-only, SameSite cookie.
2. The wallet signs the human-readable challenge.
3. `/api/auth/session` verifies the signature and creates a 12-hour HTTP-only session.
4. Protected owner routes resolve the owner from the session cookie.

High-risk mutations still require a fresh EIP-712 owner action signature with a deadline and on-chain nonce. This includes setup, policy updates, whitelist changes, key rotation, and revocation.

## Amounts and safety

Never convert money through JavaScript `Number`, `parseFloat`, or floating-point arithmetic. `parseAmount` rejects exponent notation, negative values, zero, and excess decimal places. `parseUnits`/`formatUnits` are used with the token’s configured decimals.

The policy reserves weekly usage when an approved request is created. A failed execution releases that reservation. A retry reserves it again. A request ID can only be executed once, and an execution lease expires after ten minutes for recovery from a crashed worker.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test -w apps/web
npm run test:evm
/home/sudodave/.cache/uv/archive-v0/FVCAd8-80bX6yHz_/bin/genvm-lint check contracts/genlayer/TreasuryPolicy.py
/home/sudodave/.cache/uv/archive-v0/FVCAd8-80bX6yHz_/bin/genvm-lint check contracts/genlayer/TreasuryRegistry.py
npm run build
```

The GenVM typecheck additionally requires `pyright`. The linter warns when the contract’s pinned runner is older than the latest available runner; redeploy only after validating compatibility.

For manual CLI deployments, do not pass `""` as a string constructor value
with GenLayer CLI `0.39.2`. It is decoded as integer `0`. Use the explicit
sentinel `none` for an unset method ID or whitelist; the policy constructor
treats `none` as an empty whitelist entry.

Agent spend requests use direct GenLayer transaction authentication. The
platform account signs the GenLayer write, and the policy checks
`gl.message.sender_address`, `on_behalf_of`, and the registry binding. The
pinned GenVM runner does not include `eth_account` or `eth_utils`, so the
contract uses GenLayer's native `Keccak256` instead of web3.py EIP-712
recovery. Owner setup and owner mutations still use EIP-712 signatures
verified by the server.

## Deployment sequence

1. Validate both contracts.
2. Set the GenLayer CLI network to `studionet`.
3. Import or select the platform account.
4. Deploy a fresh `TreasuryRegistry.py`.
5. Record the finalized deployment receipt, execution result, schema, and source.
6. Update `GENLAYER_REGISTRY` and `NEXT_PUBLIC_GENLAYER_REGISTRY`.
7. Run three smoke examples: auto-approved request, cap-denied request, and policy-evaluated request.
8. Confirm each transaction is `FINALIZED` and execution succeeded.
9. Deploy the Next.js app with the same registry and server-only secrets.
10. Run authenticated API and browser smoke tests.

See [docs/deployment.md](docs/deployment.md), [docs/api.md](docs/api.md), and the in-app `/docs` page.

The July 22, 2026 StudioNet release uses registry
`0x84EcD64A17071885951BC15DB8634C766E386294` and validated smoke policy
`0x252Df8515eE24e1844fFC53DA65f1AfC83d02b70`. Finalized deployment and
three-request evidence is recorded in `docs/deployment.md`.

## Security checklist

- Rotate the GitHub token if it was ever embedded in a remote URL.
- Keep `AGENT_SIGNER_PRIVATE_KEY`, `OWNER_SESSION_SECRET`, `AGENT_API_KEY_SECRET`, and `CRON_SECRET` server-only.
- Do not expose delegation payloads in logs.
- Use HTTPS in production.
- Restrict `WEB_APP_URL` and do not use wildcard CORS for relay infrastructure.
- Monitor GenLayer and 1Shot failures.
- Revoke the policy and rotate the API key if an agent credential leaks.
- Redeploy contracts after interface changes; old policies do not have the current nonce, finality, and direct-sender checks.
