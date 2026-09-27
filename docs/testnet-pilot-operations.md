# Testnet Pilot Operations

This milestone adds a MongoDB operational read model around the existing
GenLayer and Base Sepolia request flow. MongoDB records safe request metadata,
append only lifecycle events, rate limit windows, and structured tester
feedback. It never authorizes a payment and it never replaces onchain state.

## Required deployment settings

Set these server only variables in Vercel:

```text
MONGODB_URI=mongodb+srv://...
MONGODB_DB=treasury_copilot
ADMIN_WALLET_ALLOWLIST=0xFounderWallet
```

`MONGODB_URI` enables durable request projections, lifecycle events, testnet
rate limits, feedback storage, and pilot analytics. `MONGODB_DB` defaults to
`treasury_copilot` when omitted. `ADMIN_WALLET_ALLOWLIST` is optional during
local development, but must be set before public pilot operations are enabled.

### MongoDB Atlas network access

Atlas rejects connections from addresses outside its Network Access list during
the TLS handshake, which surfaces as `MongoServerSelectionError` with
`tlsv1 alert internal error` rather than an authentication failure. Vercel
functions do not have stable egress addresses on the current plan, so the pilot
cluster must allow `0.0.0.0/0` in **Network Access** and rely on the database
user credential plus the server only environment variable for access control.
A paused free tier cluster produces the same unreachable result and must be
resumed before the health endpoint can report `healthy`.

Verify the allowlist before deployment, because the spend endpoint fails closed
when `MONGODB_URI` is configured but the cluster cannot be reached.

The health endpoint reports MongoDB as `healthy` only after a live database
ping succeeds. The service reports degraded health when durable pilot storage
is missing or unavailable.

## Operator access

Sign in through the existing owner wallet session and open `/admin`. The
operator console is read only in this milestone. It shows request projections,
lifecycle events, dependency status, and aggregate pilot counts.

The following endpoints require the owner session and the optional allowlist:

```text
GET /api/pilot/overview
GET /api/pilot/requests
GET /api/pilot/events
GET /api/pilot/dependencies
```

The public tester feedback endpoint is:

```text
POST /api/pilot/feedback
```

Feedback is limited to structured category, severity, description, request ID,
correlation ID, and tester label. Credentials, signatures, evidence payloads,
and private key material must never be submitted.

## Data authority

GenLayer remains authoritative for policy, verdict, and request state. Base
Sepolia remains authoritative for settlement receipts. MongoDB is an indexed
operational read model that may be stale or unavailable without granting any
spending authority.

Every agent spend response returns an `x-correlation-id` response header and a
`correlation_id` response field. The same identifier is stored with the safe
request projection and lifecycle events.

## Testnet controls

Open access is restricted to the testnet environment. The spend endpoint adds
durable MongoDB backed windows of 60 requests per API key per minute and 180
requests per agent per minute when MongoDB is configured. Existing onchain
per request caps, weekly caps, registry binding checks, and idempotency rules
remain authoritative.

If MongoDB becomes unavailable, read APIs continue to use authoritative
onchain state and log the failed projection. Public spend submission fails
closed before creating a new request because open testnet abuse protection
depends on the durable rate limit. Production Mainnet must not be enabled
without durable external rate limiting and operational storage.
