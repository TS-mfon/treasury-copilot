# Treasury Copilot — Multi-User, Agent-API Upgrade Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convert Treasury Copilot from a single-owner beta demo into a multi-user production dapp where humans do setup via wallet, and agents integrate through an HTTP API key; on each spend, the platform signer submits EIP-712 + direct GenLayer writes, GenLayer evaluates, and approved requests are executed automatically via 1Shot while history, policy edits, ownership, error handling, X Layer support, and Obsidian UX are all tightened.

**Architecture:** Keep agents simple: HTTPS JSON + API key. Keep human interactions Web3: wallet login + on-chain ownership. Keep execution environment-node-backed server only: Node APIs per AGENT.md/Vercel notes, no Edge routes. Move from one hardcoded policy to per-agent owner → agent → policy → funding-source → chain/asset bindings authenticated on every request. Use registry binding, request-ID state, and execution leases to prevent replay/cross-agent use.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, viem, genlayer-js, 1Shot hosted JSON-RPC relayer, wagmi/EIP-6963, Tailwind Obsidian theme, Foundry EVM contracts, GenVM Python contracts.

---

## Phase 0 — Goal, docs, and current-state check

Assumptions validated from `AGENT.md` and `README.md`:
- Platform signer private key remains server-side only.
- 1Shot uses hosted URL only; no client-credential identity; redelegate permission context per current implementation.
- GenLayer evaluations happen for every request; approved backend path writes and then executes 1Shot; record execution on GenLayer.
- Existing deployed StudioNet policy/registry addresses are temporary; building the real product requires per-agent registry registration from setup onward.

### Task 0.1: Inspect existing route contracts and shared types before patching

**Objective:** Identify confirmation points and rename spots for `/api/v1` routes.

**Files:**
- Read: `apps/web/src/app/api/register-delegation/route.ts`
- Read: `apps/web/src/app/api/submit-agent-request/route.ts`
- Read: `apps/web/src/lib/apiServer.ts`
- Read: `apps/web/src/lib/apiAuth.ts`
- Read: `apps/web/src/lib/errors.ts`
- Read: `apps/web/src/lib/metamaskDelegation.ts`
- Read: `apps/web/src/lib/oneShot7710.ts`
- Read: `apps/web/src/lib/relay.ts`
- Read: `packages/shared/src/index.ts`
- Read: README, AGENT.md, API-UX

**Step 1:** Read core route libraries. **Step 2:** List current public route tree under `/app/api`. **Step 3:** Flag any frontend-callable legacy paths that will be replaced.

### Task 0.2: Add actionable TODO to-do checklist in repo tracking file

**Objective:** Give execution an owner-visible task list so user can follow progress.

**Files:**
- Create: `.hermes/plans/TODO.md`
- Modify: `README.md` if tracked tables are missing

**Step 1:** Write phased checklist templates. **Step 2:** Generate runnable checklist for this plan. **Step 3:** Verify with `cat .hermes/plans/TODO.md`.

---

## Phase 1 — Backend API key auth, ownership, and error envelope

### Task 1.1: Introduce raw Vercel server env constants file

**Objective:** Stop putting secrets in the route handler scope and add validated env loading.

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Modify: `API-UX.md` references only in follow-up docs tasks

**Step 1: Write test**

```ts
import { getEnv } from '@/lib/env';

test('rejects missing API key secret', () => {
  const prev = process.env.AGENT_API_KEY_SECRET;
  delete process.env.AGENT_API_KEY_SECRET;
  expect(() => getEnv()).toThrow('missing env');
  process.env.AGENT_API_KEY_SECRET = prev;
});
```

**Step 2: Run failure**

Run: `npm run typecheck -w apps/web --if-present`
Expected: test hook not yet wired; we just want to see parse path exists.

**Step 3: Write minimal env helper**

```ts
export type Env = {
  node: 'nodejs';
  agentApiKeySecret?: string;
  ownerSessionSecret?: string;
  oneShotRelayerUrl: string;
  signerPrivateKey: Hex;
  allowedGenLayerPolicies: string[];
  allowedEvmChainIds: number[];
  registryAddress: Address;
  treasuryAddress?: Address;
  maxSpendRawAmount: bigint;
  defaultTokenDecimals: number;
};

export function loadEnv(): Env {
  const missing = [];
  if (!process.env.ONESHOT_RELAYER_URL) missing.push('ONESHOT_RELAYER_URL');
  if (!process.env.AGENLAYER_RPC_URL) missing.push('GENLAYER_RPC_URL');
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
  // continue out-of-band extraction only inside __NEXT_PRIVATE_* or server runtime in implementation.
}
```

**Step 4: Run typecheck**

Run: `npm run typecheck -w apps/web --if-present`
Expected: passes, or no new TS errors.

### Task 1.2: Replace legacy API-key paste flows with signed, self-contained API tokens tied to registry entries

**Objective:** Each owner setup returns one opaque API key for an agent; no more raw privateKey-based agent keys in `agent.ts`.

**Files:**
- Modify: `apps/web/src/lib/agent.ts`
- Modify: `apps/web/src/app/api/sign-agent-request/route.ts`
- Create new: `apps/web/src/lib/agentApiKeys.ts`
- Update docs in plan only until implemented later.

**Step 1: Write failing test**

Expect `generateAgentKey` is replaced; apps calling it break initially.

**Step 2: Run test suite**

Run: `npm run typecheck -w apps/web --if-present`
Expected: breaks on removed symbols.

**Step 3: Implement minimal wrapper**

```ts
export type AgentApiKey = { kid: string; agentAddress: Address; registryId: Hex; issuedAt: number };

export function signAgentApiKey(...) { return jws.sign(payload, secret); }
export function unsignAgentApiKey(token: string) { ... }
```

**Step 4: Accept breaking behavior with fallback migration notes.**

### Task 1.3: Add owner onboarding session auth

**Objective:** Add httpOnly signed owner session separated from agent keys.

**Files:**
- Create: `apps/web/src/lib/ownerAuth.ts`
- Create: `apps/web/src/app/api/auth/owner-session/route.ts`
- Modify: `apps/web/src/app/layout.tsx` to inject session cookies

**Step 1: write test for sign/verify/rotate flow.**

**Step 2: run test expected fail.**

**Step 3: write owner session classes with methods: `createOwnerToken`, `verifyOwnerToken`, `refreshOwnerToken`, `destroyOwnerToken`.**

**Step 4:** Add `/api/auth/nonce`, `/api/auth/verify-wallet-signature`, `/api/auth/logout`. Secret from `NEXT_PUBLIC_OWNER_SESSION_SECRET`. **NOTE:** Next.js API routes cannot use names starting with underscores. Add `export const runtime = 'nodejs'` to all new auth routes.

**Step 5:** Run typecheck.

### Task 1.4: Complete machine-readable error catalogue and helpers

**Objective:** Get stable JSON envelopes everywhere.

**Files:**
- Modify: `apps/web/src/lib/errors.ts`

Add exports:
```ts
export type ApiError = {
  code: 'invalid_payload' | 'chain_not_allowed' | 'policy_not_allowed' | 'agent_unknown' | 'registry_mismatch' | 'invalid_decimal' | 'cap_exceeded' | 'denied' | 'pending_relay' | 'unsupported_wallet_rpc' | 'genlayer_unavailable' | 'oneshot_unavailable' | 'insufficient_gas' | 'key_revoked' | 'request_id_replay';
  message: string;
  request_id?: string;
  fields?: string[];
  retry_after_ms?: number;
};

export function apiError(error: ApiError, status = 400) { return Response.json({error}, {status}); }
```

**Step 1:** Implement stable error schema. **Step 2:** Replace ad-hoc `error.message` responses in `/api/register-delegation`, `/api/submit-agent-request`, `/api/execute-approved-request`. **Step 3:** Run typecheck.

---

## Phase 2 — Agent HTTP API (`/api/v1`) and registry-backed request lifecycle

### Task 2.1: Add shared server types

**Files:**
- Modify: `packages/shared/src/index.ts`

```ts
export interface AgentRequestPayload {
  agent_address: Address;
  recipient: Address;
  amount: string; // decimal USDC/OKB
  token?: Address;
  category: string;
  justification: string;
  requestId?: Hex;
}

export interface PlatformSignerRequest { ... }
```

### Task 2.2: Create `/api/v1/spend` route with agent-api-key auth and policy/registry reconciliation

**Files:**
- Create: `apps/web/src/app/api/v1/spend/route.ts`

**Objective:** Only behavior change from prior approach: keep same EIP-712 + direct GenLayer writes; require agent api key, agent_address from body, registry lookup, policy lookup; compute exact units with `parseUnits(body.amount, tokenDecimals)`; derive deterministic requestId; build EIP-712 "TreasuryRequest"; sign and write `submit_request`; if approved, execute 1Shot and `record_execution`; return envelope.

Key invariants:
- amount is a positive decimal string only; `Number(amount)` is never used for on-chain amounts.
- decimals come from token config: 6 for USDC, 18 for native OKB if wrapped, else native amount path through 1Shot.
- Optional `requestId` allowed; if omitted, compute `keccak256(payload)`.
- On any route failure, return typed `apiError` with `fields` only when validation-derived.

**Step 1: Write failing integration harness.**

**Step 2: Run typecheck and expect failure because of missing genlayer write helper contract form.**

**Step 3: Implement.**

**Step 4: Run tests and typecheck.**

### Task 2.3: Create `/api/v1/balance` and `/api/v1/history` reads

**Files:**
- Create: `apps/web/src/app/api/v1/balance/route.ts`
- Create: `apps/web/src/app/api/v1/history/route.ts`

Behavior:
- balance reads `get_policy` and token balance for delegated account.
- history returns `get_requests_for_agent(ownerAddress, agentAddress)` mapped into JSON.
- Executions merge `record_execution`/tx_hash and 1Shot status.

### Task 2.4: Create `/api/v1/requests/:id` endpoint

Files as above add read path for request lifecycle + explorer link when EVM chain is active.

### Task 2.5: Create relayer/cron for approved-request execution

**Files:**
- Modify: `apps/web/src/app/api/cron/execute/route.ts` or create new handler
- Add vercel cron config target and docs in `docs/deployment.md`.

Invariants:
- Block duplicate execution via on-chain lease or single-use `request_id` state before sending.
- Return typed failure if GenLayer approved but 1Shot unavailable; schedule retry.

### Task 2.6: Deprecate legacy `/api/register-delegation`, `/api/submit-agent-request`, `/api/execute-approved-request`

**Objective:** Keep `/api/register-delegation` only under owner session auth and `/api/v1/admin/register-delegation`. Move agent entry to `/api/v1`.

**Files:**
- Modify legacy routes to return 301/410 doc links unless protected by owner auth transitional mode.

---

## Phase 3 — GenLayer contract updates for multi-user and approval flow

### Task 3.1: Add `TreasuryRegistry` policy/capability verification by owner/agent address

**Files:**
- Modify: `contracts/genlayer/TreasuryRegistry.py`

Adds:
```python
@gl.public.read
def get_policy_by_owner_agent(owner: str, agent: str) -> dict: ...
```

### Task 3.2: Update `TreasuryPolicy.submit_request` for platform-gateway submission

**Files:**
- Modify: `contracts/genlayer/TreasuryPolicy.py`

Invariants:
- Add optional `on_behalf_of: str = ""`
- If `on_behalf_of` provided, sender must equal `authorized_gateway` and `on_behalf_of` must match `authorized_agent`; otherwise enforce EIP-712 recovery against signer==authorized_agent.

### Task 3.3: Add `request_state` and `execution_lease` fields

**Files:**
- Modify: `contracts/genlayer/TreasuryPolicy.py`

Add `execution_state: None | {'tx_hash': str, 'error': str, 'request_id': str}` + `lease: dict` with `request_id` + nonce to prevent duplicate payout.

### Task 3.4: Add policy history query

**Files:**
- Modify: `contracts/genlayer/TreasuryPolicy.py`

Add `get_requests_for_agent` and `get_execution` read helpers.

### Task 3.5: Re-run GenVM lint after each change

**Files:**
- Command: `uvx --from genvm-linter genvm-lint check contracts/genlayer/TreasuryPolicy.py`

Keep pinned runner header intact.

---

## Phase 4 — Error handling and decimal safety

### Task 4.1: Add single-source USDC/OKB decimal/unit helpers

**Files:**
- Create: `apps/web/src/lib/amounts.ts`

```ts
export function parseSafeAmount(value: string, decimals: number): bigint;
export function enableRejectedConversionError(value: string, decimals: number): bigint;
```

Reject malformed decimals like `1.23456789` for USDC after 6 places.

### Task 4.2: Apply unit conversion everywhere spend amounts flow

Files:
- `/api/v1/spend/route.ts`
- `oneShot7710.ts`
- `agent.ts` observes only sign helper; migrate to platform-signer paths.

### Task 4.3: Add error wrapping for every node failure class

Rail-specific errors:
- ERC-7715 capability detection failure returns `unsupported_wallet_rpc`.
- Insufficient USDC balance returns `insufficient_funds`.
- Insufficient gas for relayer/owner setup returns `insufficient_gas` with `retry_after_ms`.
- GenLayer unavailable returns `genlayer_unavailable`.
- 1Shot unavailable returns `oneshot_unavailable`.
- Replayed `requestId` returns `request_id_replay`.

---

## Phase 5 — Setup, owner UX, policy updates, agent pages

### Task 5.1: Setup page redirect flow

Goal: `/setup` stays the human flow. But frontend should not show raw constructor args. Instead expose: chain selector, USDC/OKB selector, token amount, nominated agent address, policy text preview blob.

**Steps:**
1. Read `apps/web/src/app/setup/page.tsx`.
2. Replace manual contract-deploy form by owner-session-protected assistant that calls `/api/v1/admin/funding-options`.
3. Add ERC-7715 feature detect step with `wallet_requestExecutionPermissions`. If not present, show vault-only path.
4. Add native-gas balance warning in UI—at least an amber banner before owner confirmation.

### Task 5.2: Agent page and API docs page

**Files:**
- Modify: `apps/web/src/app/agent/page.tsx` to show how to call API.
- Modify: `apps/web/src/app/docs/page.tsx` to include code examples/copy for humans and agents endpoint by endpoint.

### Task 5.3: Policy update flow

Add `PUT /api/v1/policy` behind owner auth. Fields: auto_approve_threshold_usdc, weekly_cap_usdc, whitelist. Writes update to on-chain policy through platform signer GenLayer call.

### Task 5.4: Dashboard and history pages

**Files:**
- `dashboard/page.tsx`, `history/page.tsx`
- Use on-chain reads only; no DB fallback.

### Task 5.5: Implement recommended Obsidian theme cleanly

Files:
- `globals.css`
- `tailwind.config.ts`
- `components/*`

Add: deep-black surface base, primary purple, success green, danger red, warning amber. Fonts `Geist`/`Geist Mono`. Components emphasize terminal-style logs, badges, and fast transitions.

### Task 5.6: Create logo and site icon assets

**Files:**
- `apps/web/public/logo.svg`, `favicon.svg`, apple-touch-icon regions in layout metadata.

Use SVG monogram: TC as interlocking geometric marks. Add `<link rel="icon" href="/favicon.svg" />` in `layout.tsx`.

---

## Phase 6 — Chain and funding rail expansion

### Task 6.1: Configuration expansion to X Layer

**Files:**
- Modify: `.env.example`, `README.md`, `docs/deployment.md`, route constants with X Layer mainnet/testnet envs.

Fields:
- `NEXT_PUBLIC_XLAYER_MAINNET_RPC_URL`
- `NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL`
- `NEXT_PUBLIC_XLAYER_USDC`
- `NEXT_PUBLIC_XLAYER_OKB_WRAPPED`
- 1Shot capability preflight per chain using hosted reloyer capability call.

### Task 6.2: Capability preflight screen in setup

**Files:**
- `apps/web/src/lib/capabilityChecks.ts`

Checks:
- `wallet_requestExecutionPermissions` support.
- 1Shot channel capability for target chain.
- Token config present in env.

### Task 6.3: Fund rail selection UI

Options in setup page:
- ERC-7715 delegation rail. Shows fallback if wallet doesn't support it.

UX note: 1Shot execution gas abstraction removes the native-gas requirement for payouts; owners only need native gas for optional wallet setup transactions.

**Files:**
- `apps/web/src/app/setup/page.tsx`
- `apps/web/src/lib/evm.ts`

### Task 6.4: Anti-spend cross-agent isolation in 1Shot codes

Ensure relay payload in `apps/web/src/lib/oneShot7710.ts` sets `from` based on `policyState.delegated_account` and never from request body alone. Add strict ECMAScript `allowlist` schema to check `agent_address` against registry record before building relay payload.

---

## Phase 7 — Documentation, README, and agent onboarding

### Task 7.1: Rewrite README into developer and human guides

**Files:**
- `README.md`

Include:
- Value pitch / landing copy.
- Developer onboarding.
- Architecture diagram sections.
- API endpoint contract `/api/v1/spend`, `/api/v1/balance`, `/api/v1/history`, `/api/v1/requests/:id`, `/api/v1/policy`.
- Exact JSON request and response examples including decimals, error codes, request IDs, executor state fields.
- Security model—never expose platform signer/policy/delegation internals.
- Chain support matrix—Base Sepolia, Arbitrum Sepolia, X Layer mainnet/testnet, which rails are available on which chain.
- Deployment + env table with server-only vs public names.

### Task 7.2: Expand `docs/api-reference.md`

Add curated copy from `docs/deployment.md` expanded into endpoint-by-endpoint section. Include recovery flow, how `requestId` replay is prevented, what "pending_relay" means, what EVM explorer link is returned for each chain.

### Task 7.3: Write `docs/owner-setup.md` and `docs/agent-quickstart.md`

Step-by-step for both humans and agents. Include screenshot placeholders for setup flow and `curl --header "Authorization: Bearer ..."` code blocks.

---

## Phase 8 — Automated verification

### Task 8.1: Startup repository-level verification

Commands must pass before merge:

```
npm run lint
npm run typecheck
npm run build
forge test --root contracts/evm
genvm-lint check contracts/genlayer/TreasuryPolicy.py
genvm-lint check contracts/genlayer/TreasuryRegistry.py
```

### Task 8.2: Agent API verification harness

Add `apps/web/tests/v1.spend.test.ts` with mocked `genlayerWrite` and `genlayerRead` and validate happy-path approval + denial + error envelopes.

### Task 8.3: Browser interaction docs

Add a text-based QA checklist that maps the actual user story: landing → setup with wallet → delegate on Base Sepolia → submit agent spend → see tx in history → update policy → rotate revoked key.

### Task 8.4: Final smoke checklist

Given rewrites, confirm:

```
_NEXT_PRIVATE_GENLAYER_RPC_URL/GATENET flows not required_
```

Confirm Node runtime on all `/api/*` routes. Confirm legacy EIP-712 path still works via developer-issued API tokens only webside.

---

## Open questions

1. Are test accounts already deployed for Base Sepolia, Arbitrum Sepolia, X Layer mainnet/testnet 1Shot backed? If no, keep X Layer behind explicit manual opt-in with `NEXT_PUBLIC_ENABLE_XLAYER=true`.
2. Do we keep per-delegation vault factory EVM contract, or only the owner-controlled vault rail once? Start with simple single vault per agent.
3. Should we accept OKB representation as wrapped or native through allowance handling? The plan assumes native pass-through when 1Shot supports native; otherwise wrapped as an ERC-20 with decimals=18.

## Browser smoke checklist

Use this checklist after each environment deploy or significant frontend change.

- Landing loads without wallet errors and presents Setup + Docs + Agent links clearly.
- Setup requires wallet connect; axis displays Base Sepolia and Arbitrum Sepolia only.
- Delegation flow shows ownership warning if no wallet is connected.
- Register delegation on GenLayer signs the setup transaction and issues one API key.
- Agent page accepts a key, shows dashboard/history/policy prompts when unauthenticated, and exposes Live and Docs modes.
- Agent `POST /api/v1/spend` returns a request record with `request_id`, `verdict`, and `status`.
- Owner history displays rejected/approved records with tx hash and explorer link where present.
- Policy page can update text, caps, whitelist, and authorized agent; changes apply to new requests only.
- README + `/docs` endpoint copy match actual routes and error formats.
- JSON amount inputs reject extra decimals, negatives, and non-numeric input through server validation.
