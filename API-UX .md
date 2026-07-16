# Treasury Copilot — Agent API Plan (Vercel-hosted)

**Companion document:** `treasury-copilot-plan.md` — this is the API/UX layer for that project alone. No marketplace, no job board, no dispute court in this document; those live in `expansion-plan.md` if you build them later. Two actors only: the human owner (does setup once) and the agent (calls the API forever after).

---

## 1. What the agent actually experiences

The agent's entire relationship with Treasury Copilot is three calls, ever:
1. Ask for its balance/limits — `GET /v1/balance`
2. Ask to spend — `POST /v1/spend`
3. Ask what happened before — `GET /v1/history`

No wallet, no signing, no GenLayer SDK, no gas, no chain selection. Just an API key and JSON.

---

## 2. Identity & auth (no database, stateless)

- At setup, the owner deploys their `Treasury` + `TreasuryPolicy` (per `treasury-copilot-plan.md`) and the API issues one signed, self-describing token — a JWT containing `agent_id`, `owner_address`, `treasury_address`, `policy_contract_address`, issued and signed with a secret only the API holds.
- That token is the agent's API key. It's sent as `Authorization: Bearer <token>` on every call.
- The API verifies the token's signature on each request — no lookup table, no stored session, nothing to persist. If the signature is valid, the contents are trusted.
- The API's own single GenLayer Studionet wallet then makes the real contract call, passing `on_behalf_of: agent_id` — the one addition `TreasuryPolicy` needs (Section 4).
- Owner-side actions (setup, editing the policy) are authenticated separately, by the owner's connected wallet signing a short message — not by the agent's API key, so an agent can never rewrite its own spending limits.

---

## 3. The API

Base URL (yours, once deployed): `https://<your-project>.vercel.app/v1` or a custom domain mapped to it.

### `POST /v1/setup` — owner only, one time
```json
// request (owner-authenticated: wallet signature proving ownership)
{
  "chain": "base-sepolia",
  "per_tx_cap_usdc": "50.00",
  "weekly_cap_usdc": "300.00",
  "auto_approve_threshold_usdc": "10.00",
  "whitelist": [],
  "policy_text": "Pay for API subscriptions and contractor invoices under $50. Never pay unknown recipients over $10 without a clear invoice reference."
}
// response
{
  "treasury_address": "0x...",
  "relayer_wallet_address": "0x...",   // fund this with gas token
  "agent_api_key": "eyJhbGciOi...",     // shown once — hand this to the agent
  "policy_contract_address": "genlayer:0x..."
}
```

### `POST /v1/spend` — agent, every time it wants to pay for something
```json
// request — Authorization: Bearer <agent_api_key>
{
  "recipient": "0xabc...",
  "amount_usdc": "25.00",
  "category": "api_subscription",
  "justification": "Monthly OpenAI API renewal, invoice #4471"
}
// response — approved
{ "verdict": "approved", "reasoning": "Within auto-approve threshold, recognized recurring category.",
  "chain": { "tx_hash": "0x..." } }
// response — denied
{ "verdict": "denied", "reasoning": "Recipient not on whitelist and justification lacks a verifiable reference." }
```
One call, one synchronous answer. No polling, nothing pending.

### `GET /v1/balance` — agent or owner
```json
{ "usdc_balance": "182.40", "weekly_spent": "40.00", "weekly_cap": "300.00" }
```

### `GET /v1/history?limit=20` — agent or owner
Server reads GenLayer's request log and the EVM `Executed` events live, merges them by request ID, and returns a flat list — the agent never has to know these are two different chains.
```json
{ "requests": [
  { "recipient": "0xabc...", "amount_usdc": "25.00", "category": "api_subscription",
    "verdict": "approved", "reasoning": "...", "tx_hash": "0x...", "created_at": "2026-07-09T14:02:00Z" }
]}
```

### `PUT /v1/policy` — owner only
```json
{ "weekly_cap_usdc": "400.00", "auto_approve_threshold_usdc": "15.00" }
```

---

## 4. The one contract change this needs

`TreasuryPolicy.submit_request()` (from `treasury-copilot-plan.md`) gains a registered gateway address and an optional `on_behalf_of` path, so the API's single wallet can act for any agent without that agent ever holding its own key:

```python
class TreasuryPolicy(gl.Contract):
    # ...existing fields...
    authorized_gateway: Address   # new — your Vercel API's GenLayer wallet address, set once at deploy

    @gl.public.write
    def submit_request(self, recipient: str, amount_atto: u256, category: str, justification: str,
                        signature: str = "", on_behalf_of: str = "") -> dict:
        if on_behalf_of:
            if gl.message.sender_account != self.authorized_gateway:
                raise gl.UserError(f"{ERROR_EXPECTED} Only the registered gateway may act on behalf of an agent")
            agent = Address(on_behalf_of)
            if agent != self.authorized_agent:
                raise gl.UserError(f"{ERROR_EXPECTED} on_behalf_of does not match this treasury's authorized agent")
        else:
            agent = _recover_eip712_signer(recipient, amount_atto, category, justification, signature)
            if agent != self.authorized_agent:
                raise gl.UserError(f"{ERROR_EXPECTED} Unauthorized signer")
        # ...rest unchanged from treasury-copilot-plan.md...
```
The direct-signature path (`signature`) still works too — this only adds a second door, it doesn't remove the first.

---

## 5. Vercel-specific build notes

### 5.1 Project layout
Next.js App Router, each endpoint as a route handler:
```
/app/api/v1/setup/route.ts
/app/api/v1/spend/route.ts
/app/api/v1/balance/route.ts
/app/api/v1/history/route.ts
/app/api/v1/policy/route.ts
```

### 5.2 Runtime — use Node, not Edge
GenLayer's SDK and the EIP-712/JWT signing both rely on Node crypto APIs that aren't available in Vercel's Edge runtime. Every route in this API needs:
```ts
export const runtime = "nodejs";
```
at the top of the file. Don't let any of these default to Edge.

### 5.3 Timeouts — the one thing that will bite you if you skip it
`/v1/spend` isn't always fast — under the auto-approve threshold it resolves instantly, but above it, GenLayer's LLM + validator consensus takes real time (multiple seconds, sometimes longer). Vercel's default function timeout (10s on Hobby) can cut that off mid-evaluation. For this route specifically:
```ts
export const maxDuration = 60; // requires a Pro plan or higher
```
Hobby plan is not enough headroom for this route — plan on Pro at minimum before this goes live with real evaluations happening above-threshold.

### 5.4 Environment variables (Vercel dashboard or `vercel env add`, never committed)
- `GATEWAY_GENLAYER_PRIVATE_KEY` — the single wallet that signs every GenLayer call. The most sensitive secret in the whole system — server-side only, never referenced in any client component.
- `JWT_SIGNING_SECRET` — signs and verifies agent API keys.
- `ONESHOT_API_KEY` — for the relayer calls.
- `BASE_SEPOLIA_RPC_URL` (and equivalents per chain as you add them).
- `GENLAYER_STUDIONET_RPC_URL`.

### 5.5 No database — and that's fine here
Every piece of state the API needs to answer a question about (balance, history, policy) is read live from chain on each request. The only thing that "exists" outside the chain is the JWT signing secret — not user data, not a queue, nothing to migrate or back up.

### 5.6 Rate limiting (optional, add later if needed)
A stateless JWT check alone doesn't rate-limit abuse. If that becomes necessary, Vercel's marketplace integrates cleanly with Upstash Redis for a lightweight per-agent rate limiter — worth adding once real usage exists, not required for the first deployment.

### 5.7 Deploy flow
`vercel link` → set the environment variables above → `vercel --prod`. Preview deployments (every branch/PR gets its own URL) are a natural fit for testing against Base Sepolia before promoting to the production deployment pointed at mainnet.

---

## 6. What the agent's owner tells it, literally

"Here's your API key. POST to `/v1/spend` with a recipient, an amount, a category, and why. You'll get back approved-or-denied, immediately, every time." That's the whole onboarding conversation.
