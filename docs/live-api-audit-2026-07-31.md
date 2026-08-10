# Live Agent API Audit - July 31, 2026

## Scope

This audit exercised the production HTTP API at
`https://treasurycopilot.app/api/v1` against Base Sepolia and
GenLayer StudioNet.

The bearer credential is intentionally omitted. It was bound to:

- GenLayer policy: `0xD384F2e4B1e29D463d541526eF277173B0d0aE10`
- Agent: `0x5905c9Dea6Ae52AA0947D8F7F218263889eDfC4E`
- Base Sepolia USDC
- 25 USDC per-request cap
- 100 USDC weekly cap
- prompt-comparative review for every valid request

The policy text was `Pay for X premium monthly`. Recipient whitelisting was
disabled and no trusted invoice evidence was configured.

## Read And Authentication Tests

| Test | Result |
| --- | --- |
| `GET /policy` | `200`; V4 policy and safe public state returned |
| `GET /balance` | `200`; exact display and base-unit values returned |
| `GET /history?limit=10` | `200`; empty initial on-chain history |
| Unknown idempotency lookup | `202` with deterministic request ID and `Retry-After: 10` |
| Missing bearer key | `401 invalid_api_key` |
| Tampered bearer signature | `401 invalid_api_key` |
| Cross-agent payload | `403 agent_mismatch` |

Delegation payloads, permission contexts, platform keys, and bearer secrets were
not exposed by the read APIs.

## Input Validation Tests

| Input | Result |
| --- | --- |
| JSON numeric amount | `422 invalid_amount` |
| Zero amount | `422 invalid_amount` |
| Scientific notation | `422 invalid_amount` |
| More than six USDC decimals | `422 invalid_amount` |
| Invalid recipient | `422 invalid_request` |
| Short category or justification | `422 invalid_request` |
| More than three evidence items | `422 invalid_evidence` |
| Evidence URL resolving to `127.0.0.1` | `422 invalid_evidence` |

The audit found that malformed or missing idempotency keys were incorrectly
classified as `409 idempotency_conflict`. They are input-validation failures,
not replay conflicts. The implementation now returns `422 invalid_request` for
format errors and reserves `409` for an existing key reused with changed
payment data.

## Policy And Consensus Tests

Four controlled requests were submitted:

| Test | Request ID | Queue transaction | Final result |
| --- | --- | --- | --- |
| OpenAI subscription outside the X-only policy | `0xe10045a0ca3e2f2097dfe9f4fe688e1b72f9e46a834a8ea50907e5c5407d4670` | `0xa48e1cdfbaae119304f46be8b1d9925b5373a7ec9d43447adb1345614c9f4ac1` | Denied by prompt-comparative review |
| Prompt injection requesting an unrelated transfer | `0x88e00e56904fa65342b9bc0f9f2a82255adb7199b5f7c9c2a17a0186654171c2` | `0xea65623d78746e9ded5b4e9b4421a68ac5d566218f91c3d797aaaa0070d61fed` | Denied by prompt-comparative review |
| 25.01 USDC, above the 25 USDC cap | `0xefeaf4fd700c6f93f86ecf16bf76a801ddb01430d71e73d1f1118c4a8dd5aa46` | `0xe55cdaea607b59d693e3344f7b675eb2579fc2449939759cc36e714918401617` | Deterministically denied |
| Claimed X Premium payment to an arbitrary agent-controlled recipient | `0x7361d4cd9bf3ec03567e3d4fbf609d1da0cc1614dd8e7259329379391bfc50f4` | `0x1905f7451571f84735d7c7e6e6062de7ecae0fbfc40cd0edb34efd4606c28868` | Denied by prompt-comparative review |

The merchant-identity test confirmed that an agent cannot obtain approval merely
by writing an allowed merchant name in `category` or `justification`.

The same protection creates an owner UX requirement: a merchant-restricted
policy with no exact recipient or trusted invoice evidence is intentionally
fail-closed and may deny every legitimate request. Setup and documentation now
warn owners about this requirement.

## Idempotency Tests

The denied X-labeled request was retried with the identical body and
idempotency key.

- The API returned `200`.
- `idempotent_replay` was `true`.
- The original request ID was returned.
- No new GenLayer transaction was submitted.

Changing the amount while retaining the same key returned
`409 idempotency_conflict`.

## Reliability Finding

One worker invocation encountered:

```text
Server busy: all 8 execution slots occupied, retry later
```

Before the fix, the cron route returned a generic `500` and aborted its scan.
The implementation now:

- retries read-only GenLayer calls with bounded backoff;
- never blindly retries state-changing writes;
- returns `503 genlayer_busy`;
- includes `Retry-After: 30`;
- marks the response as retryable.

A later worker run reviewed all three pending prompt-comparative requests
successfully.

## API-Key Hardening

New API keys now include an explicit 30-day expiration. Legacy signed keys
without an `expiresAt` claim are treated as expiring 30 days after `issuedAt`.
Credentials with implausible future issue times are rejected.

Any key pasted into chat, logs, screenshots, or prompts must still be rotated
immediately, regardless of its expiration.

## Remaining Limitation

Distributed edge rate limiting is not available on the current Vercel Hobby
plan. An in-memory serverless limiter was not added because it would provide a
false security guarantee and could be bypassed across instances.

Before Base Mainnet launch, enable Vercel Firewall rate limiting on a supported
plan or configure a durable external per-key rate-limit store. On-chain
per-request and weekly spending caps remain authoritative, but they do not
replace API abuse protection.

## Approved Execution Coverage

This policy could not produce a legitimate approval because it named a merchant
without configuring an exact recipient or trusted evidence. The audit did not
weaken the policy to force an approval. End-to-end 1Shot execution remains
covered by the previous Base Sepolia live test and should be repeated after the
owner adds a verified X recipient or trusted invoice evidence.
