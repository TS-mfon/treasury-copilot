---
name: treasury-copilot-project
description: Repository guide for understanding, changing, operating, and troubleshooting Treasury Copilot.
---

# Treasury Copilot Project Skill

Use this guide whenever you work in this repository. It explains the product model, architecture,
source of truth, development workflow, security boundaries, and the safest way to make and verify
changes. Product behavior and deployments change; inspect the current code and linked operational
documents before relying on values or status recorded here.

## 1. Project identity

Treasury Copilot is a policy-controlled payment service for autonomous agents. A human owner
authorizes bounded funding authority and configures an isolated policy for an agent. The agent
authenticates to a normal HTTPS API and requests payments. The service validates and records the
request on GenLayer, waits for the policy decision, and executes only approved requests through
the configured settlement rail.

The agent receives an API key. It does not receive the owner's wallet key, the platform signing
key, or raw wallet delegation data. The service is not trustless: owners trust the application to
protect server secrets, GenLayer to decide policy, and the selected EVM contracts and execution
provider to behave as configured.

The important separation is:

- **Policy and audit:** GenLayer StudioNet stores the registry, per-agent policies, decisions, and
  execution evidence. It is the shared policy layer for every settlement network.
- **Settlement:** USDC moves on a supported EVM network. The settlement network is not GenLayer.
- **Destination:** An approved payment can be sent to a supported CCTP destination. A destination
  chain is not necessarily a chain on which an owner can create a treasury.

For example, registering a vault on Arc Mainnet makes an Arc vault the funding and settlement
account, but the `register_vault` state change still goes to the configured GenLayer RPC. Do not
route GenLayer writes to Arc RPC or assume an Arc RPC error is a GenLayer consensus failure.

## 2. Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web/` | Next.js 15 / React 19 application, owner UI, agent API, auth, policy orchestration, chain execution |
| `apps/web/src/app/` | App Router pages and HTTP route handlers |
| `apps/web/src/lib/` | Auth, GenLayer, EVM, delegation, execution, CCTP, evidence, and domain logic |
| `apps/web/test/` | Node test runner tests for server and shared application behavior |
| `apps/relay/` | Optional small HTTP worker that authenticates and triggers the web app's retry cron route |
| `packages/shared/` | Shared viem chain registry, USDC configuration, contract ABIs, and common types |
| `contracts/genlayer/` | GenLayer Python `TreasuryRegistry` and `TreasuryPolicy` contracts |
| `contracts/evm/` | Solidity treasury/factory contracts, Foundry scripts, and EVM tests |
| `scripts/` | Contract smoke tests, network verification, deployment support, and generated docs helpers |
| `docs/api.md` | Normative agent-facing API contract and request semantics |
| `docs/deployment.md` | GenLayer, Vercel, relay, and settlement deployment instructions |
| `docs/arc.md` | Arc parameters, vault behavior, CCTP, and deployment evidence |
| `docs/arc-testing-guide.md` | Arc operational and integration verification guide |
| `apps/web/public/openapi.json` | Machine-readable public API contract |
| `docs/treasury-copilot.postman_collection.json` | Postman API examples |
| `README.md` | Product overview, architecture, current chain support, and quick local development |

Start with source code for behavior. Use API and deployment documentation for protocol and
operational procedures. If documents conflict with implementation, identify the disagreement
explicitly and check recent deployment history before changing a live-facing assumption.

## 3. High-level architecture

```text
Owner browser + MetaMask
        |
        v
Next.js owner UI and API  <---- Agent HTTPS API
        |                                |
        +-------- GenLayer StudioNet -----+---- registry, policy, decisions, audit
        |
        +-------- settlement rail ------------ Base / Arc / supported EVM networks
                 |                             1Shot or AgentTreasury executor
                 +-------- Circle CCTP v2 ------ supported payout destination

Optional relay worker --> authenticated Next.js cron endpoint
```

### Owner setup and policy binding

1. The owner authenticates with a wallet challenge and an HTTP-only session.
2. The owner selects an eligible settlement chain and USDC token and configures policy limits,
   recipients, and human-readable policy text.
3. The owner signs fresh EIP-712 authorization for the setup action.
4. For delegated settlement, MetaMask grants a bounded ERC-7715 permission. The service validates
   the permission and stores the exact context/payload on the policy.
5. For Arc settlement, the owner deploys an `AgentTreasury` vault through the chain's factory and
   registers its address as the delegated/funding account. Arc does not use the ERC-7715 / 1Shot
   path.
6. The server deploys or updates a per-agent GenLayer policy, records the owner-agent-policy
   binding in the registry, records the funding binding, and reads the state back for exact
   verification.
7. Only after successful registration and readback does the server issue the signed `tcp_` API
   key. The UI shows it once.

Registration is multi-step and can have already completed some on-chain operations when a later
step fails. Diagnose the current registry and policy state before blindly repeating actions.

### Agent spend lifecycle

1. `POST /api/v1/spend` authenticates the API key and validates the request, token precision,
   policy binding, identity, destination, limits, evidence, and idempotency key.
2. The service records/submits the request to the policy on GenLayer using the server platform
   signer. A successful submission normally returns `202 Accepted` and a request ID; it does not
   mean that settlement has completed.
3. The service or authenticated retry worker observes GenLayer finality and the execution result.
4. A denial remains auditable and is not executed.
5. An approval can proceed only after all deterministic checks and finality requirements pass.
   Delegated chains execute through 1Shot within the owner's permission. Arc uses the isolated
   vault executor. Eligible cross-chain payments use Circle CCTP v2 and its forwarding flow.
6. The outcome and EVM transaction evidence are recorded on GenLayer and exposed through status
   and history endpoints.

Finalized GenLayer status alone is not success. Check consensus result, leader execution, rollback
payloads, and (for deployment) schema/code or readback. The helpers in `genlayerServer.ts` enforce
this for application writes; preserve those fail-closed checks.

## 4. Chain and settlement model

`packages/shared/src/index.ts` is the canonical code source for chain IDs, token addresses, CCTP
domains, destination eligibility, settlement backends, and per-chain relayer configuration.
`README.md` contains generated chain tables: update the registry and use the documented generator
rather than hand-editing generated table regions.

The main backend types are:

- `delegated-7710`: owner-authorized ERC-7715 permission executed by the matching 1Shot relayer.
- `arc-vault`: owner-deployed `AgentTreasury`, paid by the separate platform Arc executor.

Never infer that a chain can hold a treasury just because it is a CCTP destination. Check
`destinationOnly`, `executionBackend`, the active chain ID allowlist, actual relayer capabilities,
and server kill switches. Relayers can be environment-specific; Base Mainnet and Base Sepolia use
different 1Shot environments. Do not collapse them into one global URL.

Arc is special in this project:

- Arc USDC is native gas on Arc, but the token contract has an ERC-20 interface. Do not conflate
  native gas decimals with ERC-20 token decimals.
- Arc has no supported MetaMask Delegation Framework or 1Shot capability, so payouts use a vault.
- Arc Mainnet executor keys are deliberately separate from Arc Testnet keys and from the
  GenLayer platform signer. Never add a silent key fallback.
- Arc Mainnet payout signing requires the mainnet executor configuration and funding. A registered
  vault may exist while payout execution remains disabled or unavailable.
- Cross-chain burn amount, Circle fee, hook, attestation, and forwarding behavior are sensitive to
  exact protocol semantics. Consult `docs/arc.md` and its verification scripts before modifying.

Treat deployed addresses and status as time-sensitive. Derive current values from chain config,
environment, deployment docs, and current on-chain inspection; never copy a stale address from a
slide deck or old audit into code.

## 5. Where to make changes

| Change requested | Begin inspection here |
| --- | --- |
| Owner setup or wallet auth | `apps/web/src/app/setup/`, `apps/web/src/lib/ownerAuth.ts`, `ownerSession.ts`, `ownerActions.ts` |
| Agent key issuance or checks | `apps/web/src/lib/agentApiKeys.ts`, `apiAuth.ts`, `apiServer.ts` |
| Setup registration | `apps/web/src/app/api/v1/setup/route.ts`, `apps/web/src/lib/genlayerServer.ts`, `executionBackend.ts` |
| Spend validation/status/execution | `apps/web/src/app/api/v1/`, `apiServer.ts`, `automaticReview.ts`, `executionBackend.ts` |
| GenLayer transactions | `apps/web/src/lib/genlayerServer.ts`, `contracts/genlayer/` |
| Arc vault or CCTP | `apps/web/src/lib/arcVault.ts`, `arcFunding.ts`, `cctp.ts`, `cctpBridge.ts`, `gateway.ts`, `docs/arc.md` |
| 1Shot execution | `apps/web/src/lib/oneShot7710.ts`, `apps/web/src/lib/relay.ts`, chain config |
| Shared chain behavior | `packages/shared/src/index.ts`, then relevant chain/UI/API tests and generated docs |
| Retry/cron | `apps/web/src/app/api/cron/execute/route.ts`, `automaticReview.ts`, `apps/relay/src/server.ts` |
| API contract/docs | `docs/api.md`, `apps/web/public/openapi.json`, Postman collection, corresponding route code |
| Pilot/admin tools | `apps/web/src/app/api/pilot/`, `pilotStore.ts`, `docs/testnet-pilot-operations.md` |
| Solidity | `contracts/evm/src/`, associated Foundry tests/scripts, then shared ABIs and frontend integrations |

Search call sites before changing shared helpers. In this monorepo, a shared chain or API change
can affect setup UI, API validation, funding, payout execution, health reporting, docs, and scripts.

## 6. Development commands

Requirements and exact commands are documented in `README.md` and `docs/deployment.md`. The root
uses npm workspaces; run commands from the repository root unless a command explicitly says
otherwise.

```bash
npm install
npm run dev
npm run relay:dev
npm run typecheck
npm run lint
npm run test -w apps/web
npm run test:evm
npm run lint:genlayer
npm run build
```

The relay is optional for local web development. It only invokes the authenticated web cron
endpoint; it never accepts or signs payout instructions. The GenLayer linter target in the root
script may cover only the policy contract, so use deployment docs for commands that lint both
GenLayer contracts.

Do not run tests, builds, deploys, smoke scripts, or on-chain verification unless the user asked
for verification or the task requires it and that action is authorized. When authorized, run the
narrowest useful checks first and report exactly what ran. Never claim an unrun check passed.

## 7. Configuration and secrets

`.env.example` is a template, not a complete guarantee of current production configuration.
`apps/web/src/lib/env.ts` validates a subset of server configuration; several chain-specific
settings are read directly at their usage sites. See `README.md`, `docs/deployment.md`, and
`docs/arc.md` for the full environment model.

Key variables include:

- GenLayer: `AGENT_SIGNER_PRIVATE_KEY`, `GENLAYER_REGISTRY`,
  `NEXT_PUBLIC_GENLAYER_REGISTRY`, `GENLAYER_RPC_URL`, and
  `NEXT_PUBLIC_GENLAYER_RPC_URL`. The server GenLayer client should use the configured RPC; the
  public variable is the documented fallback. Keep registry addresses consistent across server
  and browser.
- Owner/API authentication: `OWNER_SESSION_SECRET`, `AGENT_API_KEY_SECRET`.
- Retry: `CRON_SECRET`, `WEB_APP_URL`, `PORT`.
- Relayer: `ONE_SHOT_RELAYER_URL` plus public counterpart where applicable; chain-specific URLs
  can override it.
- Arc: chain-specific RPC/factory/executor variables, `ARC_EXECUTOR_PRIVATE_KEY`,
  `ARC_MAINNET_EXECUTOR_PRIVATE_KEY`, and `ARC_SETTLEMENT_ENABLED` as documented for the target
  deployment.
- CCTP/Gateway: `CCTP_ENABLED`, `GATEWAY_ENABLED`, supported chain RPC overrides.
- Optional pilot operations: `MONGODB_URI`, `MONGODB_DB`, `ADMIN_WALLET_ALLOWLIST`.

Never print secrets, include them in code or docs, pass them into public variables, commit local
environment files, paste API keys or signatures into logs, or return full provider error bodies
if they may echo credentials. Do not inspect secret values unless necessary; report whether a
variable is configured rather than its value. Keep signer duties separated: the GenLayer registry
gateway/reporter key must not be reused as an Arc executor key.

## 8. Security and implementation rules

These are core product invariants. Preserve them during refactors and describe explicitly if a
requested change would alter one.

1. **Never give an agent signing authority.** API credentials identify an agent; the server
   platform signer submits GenLayer writes. Owner wallet and executor keys remain private.
2. **Fail closed.** No API key on partial setup; no payout on uncertain or non-final verdict;
   no execution after a GenLayer rollback; no fallback to another chain's signer.
3. **Validate every binding.** Match API key claims against active registry state, including owner,
   agent, policy, funding account, chain, token, key version, and active flag.
4. **Use exact token arithmetic.** Parse decimal strings into integer token units. Do not use JS
   floating point for money and do not accept exponent notation or excess precision.
5. **Keep deterministic checks deterministic.** Identity, amount caps, weekly budget, destination
   eligibility, whitelist, nonce, replay prevention, leases, and token parameters must not depend
   on an LLM verdict.
6. **Maintain idempotency.** A timeout is not proof a request was rejected. Resolve by the same
   key or retry the identical request with the same idempotency key; do not mint a second payment.
7. **Preserve evidence carefully.** Redact delegation payloads and secrets from API responses,
   logs, errors, and UI. Keep stable machine-readable error codes for agents.
8. **Verify state changes.** Read back registry/policy updates and validate exact values. For
   deployments, inspect execution status and contract schema/code in addition to finality.
9. **Respect chain roles.** Separate settlement-chain eligibility from CCTP destination eligibility
   and from 1Shot capabilities. Check the capability on the proper environment.
10. **Use fresh owner authorization.** Sensitive owner operations require the expected session and
    fresh EIP-712 authorization. Do not weaken nonce/deadline/replay checks for convenience.

Before changing transaction, signing, or settlement code, trace both success and failure paths,
including retries, replays, partially completed setup, chain/environment selection, and stored
readback. Do not invent trust assumptions absent from the implementation.

## 9. API orientation

The normative reference is `docs/api.md`; use it rather than duplicating or guessing request
semantics. The main agent routes are:

- `GET /api/v1/policy` — policy/binding information safe to expose to the agent.
- `GET /api/v1/balance` — balance and policy limits.
- `POST /api/v1/spend` — submit an idempotent payment request.
- `GET /api/v1/requests` and `GET /api/v1/requests/[id]` — recover and poll request state.
- `GET /api/v1/history` — authorized agent history.
- `GET /api/v1/setup` and `POST /api/v1/setup` — owner-authorized registration/setup flow.

Owner auth and management routes live under `/api/auth/` and `/api/owner/`. Pilot/operator routes
live under `/api/pilot/`. `/api/cron/execute` is secret-protected and must remain an operational
retry route, not a public payout endpoint. `/api/health` reports service dependencies/configuration;
it should not expose secret values.

Machine-readable contract: `apps/web/public/openapi.json`. If changing an API payload or response,
update the route, docs, OpenAPI, Postman/examples where affected, and relevant error mapping. Keep
idempotency/recovery semantics backward compatible where possible.

## 10. Troubleshooting workflow

For a reported failure:

1. Find the user-facing text and route with `rg`, then follow calls down into the relevant
   `src/lib` helper and contract method.
2. Identify whether failure is local validation, owner authorization, RPC transport, GenLayer
   submission, GenLayer finality/consensus, contract execution, EVM execution, or external CCTP /
   relayer behavior. These are distinct layers.
3. Inspect the response status and content type where HTTP is involved. HTML beginning with
   `<!DOCTYPE` usually points to a wrong URL, proxy, platform error page, or stale endpoint, not a
   valid JSON-RPC error.
4. Check the actual server-side environment variable name and endpoint selection. Do not assume a
   `NEXT_PUBLIC_` browser setting is used by a server SDK unless code explicitly wires it.
5. Check chain ID, configured backend, deployment addresses, and feature/kill switches.
6. For submitted GenLayer transactions, retain the hash and inspect lifecycle, consensus result,
   leader execution and rollback output. Finalized may still mean contract execution failed.
7. For EVM payouts, inspect the request record, executor/relayer response, receipt, token transfer
   and resulting policy evidence. Do not resend under a new request key until replay state is
   understood.
8. Make the smallest safe fix, update documentation if configuration or operations change, and
   state tests/verification performed and limitations.

Common cases:

- **Vault registration gives HTML/JSON parse error:** Arc is only the settlement network. The
  `register_vault` call is a GenLayer write. Verify that server GenLayer client uses the configured
  StudioNet JSON-RPC endpoint (`GENLAYER_RPC_URL` or documented public fallback), and that the
  endpoint returns JSON-RPC rather than an HTML page. Check registry/policy state before retrying.
- **Setup reports gateway authorization failure:** compare the derived platform signer with the
  registry's authorized gateway and verify both registry env variables point to the same active
  deployment.
- **Finalized write has no usable state:** inspect execution result and GenVM rollback details,
  then confirm readback. Never treat consensus finality as sufficient evidence.
- **Approved request is not paid:** inspect `execution_status` and `execution_error`; preserve the
  original request/idempotency key and use the supported retry/recovery path.
- **Delegation setup fails:** verify wallet capability, chain switch, token, time window, amount,
  delegate address, permission context, and exact readback. MetaMask granting permission is not
  the same as registering the policy.
- **Arc payout does not sign:** verify Arc settlement is enabled, the proper network-specific
  executor key/address is configured and separated from the GenLayer signer, and the executor is
  funded for Arc gas. Do not substitute the testnet key for mainnet.
- **Cross-chain transfer stalls:** check Circle environment (mainnet/testnet), source/destination
  eligibility, burn message, fee, attestation, and forwarding support. Do not assume all CCTP
  domains are forwarding destinations.
- **Agent receives `no_record`:** this means no request is visible under that key in GenLayer. Use
  the returned recovery instructions and same idempotency key; do not treat a derived request ID
  as proof of submission or payment.

## 11. Documentation and generated artifacts

Maintain one source of truth. Shared chain definitions live in `packages/shared/src/index.ts`;
generated README network tables say so in their marker comments. OpenAPI and Postman contracts must
track the implemented routes. Deployment addresses, signer roles, required env variables, kill
switches, and network capabilities belong in the relevant operational docs.

Do not add confidential operational data to examples. Treat investor materials, screenshots,
generated decks, local artifacts, and unrelated untracked files as out of scope unless the user
specifically requests work on them. Stage only files relevant to the task.

## 12. Git and delivery

- Check `git status`, current branch, and diff before editing and before committing.
- Preserve user changes. Do not reset, clean, or stage unrelated files.
- Do not create a commit or push unless the user explicitly asks; if asked, commit only the
  intended files and push the requested branch/remote.
- Do not deploy, submit on-chain transactions, move funds, rotate keys, or change production env
  without explicit authorization for that action.
- In the final report, summarize changed files, user-visible effects, checks that actually ran,
  and whether the change was committed or pushed.

## 13. Documentation index

- Product and repository overview: `README.md`
- Agent integration contract: `docs/api.md`
- Deployment and operations: `docs/deployment.md`
- Arc, vault, and CCTP details: `docs/arc.md`
- Arc end-to-end guide: `docs/arc-testing-guide.md`
- Pilot operations: `docs/testnet-pilot-operations.md`
- OpenAPI: `apps/web/public/openapi.json`
- Source implementation: `apps/web/src/`, `packages/shared/src/`, `contracts/`
