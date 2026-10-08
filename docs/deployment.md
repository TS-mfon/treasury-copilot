# Treasury Copilot Deployment

This document describes a clean deployment of the current ERC-7715-only architecture. Existing single-policy addresses are not compatible with the current nonce, finality, and binding checks. Deploy fresh GenLayer contracts.

## 1. Prerequisites

- Node.js 20+.
- npm workspaces installed.
- Foundry for EVM regression tests.
- GenLayer CLI `0.39.2` or newer.
- `genvm-lint`.
- A platform private key in `/home/sudodave/.env.build` or an environment variable.
- A Vercel project connected to this repository.

StudioNet is gasless. A zero GEN balance is expected. The platform account still needs a private key to sign deployment and write transactions.

## 2. Validate locally

```bash
npm install
npm run typecheck
npm run lint
npm run test -w apps/web
npm run test:evm
genvm-lint check contracts/genlayer/TreasuryPolicy.py
genvm-lint check contracts/genlayer/TreasuryRegistry.py
npm run build
```

The linter’s runner-version warning is informational. Do not change the pinned runner in a deployed contract without rerunning all smoke tests.

## 3. Configure GenLayer CLI

Use the built-in network configuration. Do not pass `--rpc` for StudioNet because the CLI needs the matching StudioNet consensus configuration:

```bash
genlayer network set studionet
genlayer network info
genlayer account
```

If the account is not imported:

```bash
genlayer account import --name treasury-copilot --private-key "$GENLAYER_PRIVATE_KEY"
genlayer account use treasury-copilot
```

Do not print private keys or commit them.

## 4. Deploy the registry

```bash
genlayer deploy --contract contracts/genlayer/TreasuryRegistry.py
```

Capture the transaction hash. Wait for finality and inspect execution:

```bash
genlayer receipt 0xREGISTRY_DEPLOY_TX --status FINALIZED
genlayer receipt 0xREGISTRY_DEPLOY_TX --stdout
genlayer receipt 0xREGISTRY_DEPLOY_TX --stderr
genlayer schema 0xREGISTRY_ADDRESS
genlayer code 0xREGISTRY_ADDRESS
```

Finalized lifecycle status is not enough. A finalized transaction can contain an execution error. The receipt must show successful execution and the schema/code lookup must return the deployed contract.

## 5. Deploy a policy smoke contract

The application deploys policies server-side after owner setup. For a CLI smoke deployment, pass:

```text
registry
owner
authorized_agent
execution_reporter
delegated_account
token_address
delegation_context
one_shot_method_id
evm_chain_id
per_tx_cap_atto
weekly_cap_atto
auto_approve_threshold_atto
policy_text
whitelist_csv
```

Example Base Sepolia USDC values:

```bash
genlayer deploy \
  --contract contracts/genlayer/TreasuryPolicy.py \
  --args \
  0xREGISTRY_ADDRESS \
  0xOWNER_ADDRESS \
  0xAGENT_ADDRESS \
  0xPLATFORM_ADDRESS \
  0xOWNER_ADDRESS \
  0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  smoke-context \
  none \
  84532 \
  25000000 \
  100000000 \
  0 \
  "Routine software and infrastructure spending only." \
  none
```

The application normally stores the real ERC-7715 context only after the owner approves it in MetaMask. Never use a fake delegation payload for a payout test.

Do not pass `""` for string constructor arguments through GenLayer CLI `0.39.2`.
The CLI decodes an empty shell argument as integer `0`, which fails when GenVM
stores it in a `str` field. Use an explicit string sentinel such as `none`.
`whitelist_csv=none` is intentionally treated as an empty whitelist by the
constructor.

## 6. Three finalized contract examples

Use a fresh request ID for each case. The active GenLayer CLI account must be
the policy's `execution_reporter`; the GenLayer transaction signature is the
platform authorization. The contract also requires the registered agent in
`on_behalf_of`.

### Example A: prompt-comparative approval

Policy V4 requires `auto_approve_threshold_atto=0`, so even a small valid
request receives prompt-comparative review. Expected result:

```text
FINALIZED
execution success
verdict=approved
finalized=true
execution_status=ready
```

### Example B: deterministic cap denial

Amount above `per_tx_cap_atto`. Expected result:

```text
FINALIZED
execution success
verdict=denied
reasoning contains per-transaction cap
```

### Example C: policy-evaluated request

Amount below the cap and within the policy budget. Expected result:

```text
FINALIZED
execution success
verdict=approved or denied according to validator consensus
reasoning is present
finalized=true after the V5 submission transaction finalizes
```

For each transaction, record:

- transaction hash;
- final status;
- execution result;
- stdout/stderr;
- request ID;
- verdict;
- policy address;
- explorer URL if available.

### Production registry migration: July 25, 2026

The production application uses:

```text
Registry:
0x63A045a7B3A1b173525EFFB41B07A59349Cd33D9

Registry gateway / platform signer:
0x1072e78B72840BbC921493ea1C97dC5CAA54598F

Registry deployment:
0x627aee01621e3bcb6273bfdcd0a48ec8101275ddf0612d936de3c4543e63fb07

Gateway authorization smoke:
0x74be8173aee401a841702bf4b0535b93f3fbbf8243bd0965c2af959c39379f0e
```

The deployment and authorization smoke both reached `FINALIZED`, returned
`MAJORITY_AGREE`, and completed leader execution successfully. The smoke write
used the registry's owner-only `consume_owner_nonce` path and changed a dummy
owner nonce from `0` to `1`, proving that the server platform signer is the
registry gateway.

This migration fixes policy registration transaction
`0xbbce87c335f2a18d4cf3b84b7a709ee1ed286aeddfbdf678ce5dc5397fb5f93c`,
which finalized with a GenVM rollback payload of
`[EXPECTED] Only registry gateway`. The failed policy
`0x91BCb901bc969dcbCaeEFD60067A34aF8401b000` was never registered and must
not be reused. The old registry was deployed by a different account, so its
gateway check correctly rejected the current platform signer.

Both `GENLAYER_REGISTRY` and `NEXT_PUBLIC_GENLAYER_REGISTRY` must point to the
July 25 registry. The owner can reuse a still-loaded MetaMask weekly grant
because the platform delegate did not change. A browser refresh discards the
in-memory grant and requires the permission request to be opened again.

### Active policy V4 deployment: July 30, 2026

The current owner-agent binding uses:

```text
Policy:
0xBF9Aa94fD73a883Be48B381b41eB7619181BD9fA

Policy deployment:
0x3840cfba4ef892bf5688535bd5f6ff8396b813c1b92c7f050e18e9cd3e11872a

Registry registration:
0xadc7156be2672060c9fd454a3a12682c382939fc912c513e380956c0c2003a31

Superseded V4 deactivation:
0x7975e936c3f2889c065db374d516382e02bef62d46b4ebbc0d04a7bcc889e6ae
```

All three transactions reached `FINALIZED` with successful contract execution.
The active binding uses owner
`0xEd9EDd8586b20524CafA4F568413C504C9B03172`, agent
`0xD8a4724A8F0a7c9a028Ff10527Ea354eC82fE791`, Base Sepolia chain `84532`,
canonical test USDC, and platform reporter
`0x1072e78B72840BbC921493ea1C97dC5CAA54598F`. Its fast-approval threshold is
zero and every valid request is queued for prompt-comparative review.

### Delegation-policy binding

Registration is complete only after all of these checks succeed:

1. The server validates the MetaMask grant's owner, delegate, chain, token,
   weekly atomic amount, permission context, and delegated account.
2. The registry stores the exact owner, agent, policy, chain, delegated account,
   token address, symbol, and decimals.
3. The policy stores the exact delegated account, token, permission context,
   and canonical serialized MetaMask grant.
4. The server reads the policy back and rejects setup if any stored delegation
   field differs.
5. Only then does the server issue the agent's unique signed API key.

The API key includes immutable claims for the same owner, agent, policy,
delegated account, chain, token, decimals, key ID, and on-chain key version.

### Historical StudioNet evidence: July 22, 2026

The prior implementation was validated against:

```text
Registry:
0x84EcD64A17071885951BC15DB8634C766E386294

Registry deployment:
0xc5a9ca7b13aac91ea2e41ddbf691ecd573ce1cbe4a82cc68b63b15e8bf826971

Active smoke policy:
0x252Df8515eE24e1844fFC53DA65f1AfC83d02b70

Policy deployment:
0xb9a3b5b1d5f13f49cb58d266760330a6bf51eb12bfd5b315913d8a4674fbc258

Policy registration:
0x64f26b2e233bb15eae58bcff40ed78f1e7ae1e506bf321a388284f2782b3f49c
```

All three deployment/registration transactions reached `FINALIZED`, returned
`MAJORITY_AGREE`, and committed successful leader execution.

This registry and smoke policy are retained as historical contract-test
evidence. They are superseded for production owner setup because the registry
gateway does not match the current platform signer.

Finalized request evidence:

| Case | Request ID | Verdict | Reason |
| --- | --- | --- | --- |
| 4 USDC, legacy V2 | `0xa950cc8c9896290e9d4ad01c12244ef04f248c2c85f40ed5fbf498f7648997a5` | approved | Within auto-approve threshold |
| 26 USDC | `0xd1b3316a7c4b6dc31399f2ff70a601b76339d70ac39a0458b70e1456a5dfbf40` | denied | Exceeds per-transaction cap |
| 10 USDC | `0x83cf8da66ae1d0384ed67ba05b7da530aebc1cfc7550bc74cfcfd13090db3677` | approved | Legitimate cloud observability infrastructure expense |

The third request finality marker is:

```text
0x1d2e8fab85c02c06bea5eb915fedfdc68285b69ae772e84c324b06db23896087
```

The superseded policy `0x809F30D513B0F6C366B1854043EBC13FE9955097`
was deactivated in finalized transaction
`0x1806fce4c978d1ffc23bd06c0c5bdc98049ff611e716d5f58a8c4f663ced38c6`.
It used unsupported in-GenVM `eth_account` recovery. The active policy uses the
platform-signed GenLayer transaction, `gl.message.sender_address`, native
`Keccak256`, agent attribution, and the registry binding.

## 7. Vercel environment

Set these values in Vercel Project Settings:

```text
AGENT_SIGNER_PRIVATE_KEY
OWNER_SESSION_SECRET
AGENT_API_KEY_SECRET
CRON_SECRET
GENLAYER_REGISTRY
NEXT_PUBLIC_GENLAYER_REGISTRY
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
NEXT_PUBLIC_BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
NEXT_PUBLIC_BASE_SEPOLIA_TREASURY_OPERATOR_ADDRESS
NEXT_PUBLIC_BASE_RPC_URL
NEXT_PUBLIC_BASE_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
NEXT_PUBLIC_BASE_TREASURY_OPERATOR_ADDRESS
NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS
ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers
NEXT_PUBLIC_ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers
MONGODB_URI=mongodb+srv://...
MONGODB_DB=treasury_copilot
ADMIN_WALLET_ALLOWLIST=0xFounderWallet
```

The operator address must equal the address derived from `AGENT_SIGNER_PRIVATE_KEY`. The registry address must be the fresh successful deployment.

The MongoDB values enable the testnet pilot operations read model, durable rate
limits, lifecycle event storage, and tester feedback. Keep them server only.
Verify `/api/health` reports `mongodb: healthy` before publishing the public
pilot. See [testnet pilot operations](testnet-pilot-operations.md) for the
operator console and data handling rules.

On July 30, 2026, the production 1Shot endpoint advertised Base Mainnet chain
`8453`, canonical USDC, target
`0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a`, and fee collector
`0xE936e8FAf4A5655469182A49a505055B71C17604`. Mainnet remains disabled in this
release because the approved architecture also requires a separate Mainnet
registry, gateway, reporter, EVM executor, API secrets, and cron worker. A live
relayer capability alone is not sufficient to enable real-fund execution.

Deploy:

```bash
vercel link
vercel deploy --prod
```

When using `/home/sudodave/.env.build`, load it into the deployment environment without echoing its contents:

```bash
set -a
. /home/sudodave/.env.build
set +a
vercel deploy --prod
```

Inspect the resulting deployment with:

```bash
vercel inspect https://YOUR_DEPLOYMENT.vercel.app
```

## 8. Cron and relay

`/api/cron/execute` requires `Authorization: Bearer $CRON_SECRET`. It scans
finalized queued requests, submits prompt-comparative review transactions, and
executes only finalized approvals after revalidating the policy and registry
binding. The standalone `apps/relay` process only calls this authenticated
endpoint at `/run`; it does not accept recipient, amount, delegation, or policy
payloads.

`POST /api/v1/spend` returns `202` immediately after queue submission. The
primary worker is `.github/workflows/relay-cron.yml`, which calls the
authenticated cron route every five minutes using the repository
`CRON_SECRET`. The Hobby-compatible daily Vercel cron is an independent fallback
scan. Both workers use the same idempotent on-chain review and execution leases.

## 9. Post-deploy smoke

1. Open the landing page.
2. Connect and authenticate a wallet.
3. Open setup and confirm Base Sepolia/USDC.
4. Verify unsupported wallets receive the ERC-7715 capability error before signing.
5. Configure a real delegation with a small test amount.
6. Create one small prompt-comparative API request.
7. Poll `/api/v1/requests/:id`.
8. Confirm `tx_hash` and explorer link.
9. Test a denied cap request.
10. Rotate the API key and verify the old key returns `invalid_api_key`.
11. Revoke the agent and verify balance/history endpoints reject the old binding.

## 10. Arc Testnet settlement

Arc settles differently from Base and Arbitrum. Those chains redelegate the owner's ERC-7715
MetaMask permission to the 1Shot relayer. Arc has neither the MetaMask Delegation Framework nor a
1Shot capability entry, so an approved Arc payment is executed by calling `payout` on an
`AgentTreasury` vault the owner deployed, signed by a dedicated Arc executor key.

See [Arc settlement and Circle interoperability](arc.md) for the verified network constants,
deployed addresses, and settlement evidence.

Additional Vercel environment values:

```text
NEXT_PUBLIC_ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io
NEXT_PUBLIC_ARC_TESTNET_USDC=0x3600000000000000000000000000000000000000
NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY=0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB
NEXT_PUBLIC_ARC_TESTNET_EXECUTOR_ADDRESS=0xA3bb5f926acf42460217CD1f0A88D427e5cb438b
ARC_EXECUTOR_PRIVATE_KEY
ARC_SETTLEMENT_ENABLED=true
ALLOWED_EVM_CHAIN_IDS=84532,5042002
```

`ARC_EXECUTOR_PRIVATE_KEY` must be a different key from `AGENT_SIGNER_PRIVATE_KEY`. The
application refuses to start an Arc payout when the two match, because the Arc executor must not
also be the registry gateway or the GenLayer execution reporter. Fund the executor address with
Arc USDC, which is the gas token, from <https://faucet.circle.com>.

`ARC_SETTLEMENT_ENABLED` is a server-side kill switch. With it unset or false, an Arc binding is
rejected before any transaction is built, in the same spirit as the gated Base Mainnet rollout.

Verify the wiring before and after deploying:

```bash
npx tsx scripts/verify-arc.mts executor
npx tsx scripts/verify-arc.mts factory
npx tsx scripts/verify-arc.mts chain-allowlist
npx tsx scripts/verify-arc.mts vault-executor
npx tsx scripts/verify-arc.mts settle
```

The `settle` check performs a real 0.01 USDC payout on Arc Testnet through the application's own
executor module, then asserts the recipient balance moved by exactly that amount and that the
request id is recorded as executed on chain.

## 11. Policy V6: vault settlement and per-request destination chains

V6 adds two capabilities V5 could not express.

**Vault settlement.** A V5 policy proves settlement authority with a registered ERC-7715
delegation. Arc has no delegation framework, so V6 adds a `settlement_backend` of either
`delegated-7710` or `arc-vault`, plus a `vault_address` and a
`register_vault(vault_address, token_address)` write. `register_vault` is the arc-vault counterpart
to `register_delegation`: it refuses unless the vault matches the funding account the registry
already pinned, so the vault cannot be swapped for another contract after registration.

**Per-request destination chains.** `queue_request` takes an optional `destination_chain_id`. Empty
means settle on the policy's own chain, which keeps every V5-shaped caller working. The owner
controls an allowlist via `set_destination_chain_entry`, the settlement chain is always permitted
and cannot be removed, and a destination outside the allowlist is a deterministic denial recorded
before any policy review runs. Because the destination is reviewed and stored on chain, a relayer
cannot redirect an approved payment to a chain the policy never approved.

Requests also carry independent `bridge_tx_hash`, `attestation_status` and `destination_tx_hash`
state, written by `record_bridge_initiated` and `record_bridge_attested`, so a cross-chain payment
tracks its source burn, its attestation and its destination mint separately from execution.

### Constructor arguments

V6 appends two arguments to the V5 signature:

```text
registry owner authorized_agent execution_reporter delegated_account token_address
delegation_context one_shot_method_id evm_chain_id per_tx_cap_atto weekly_cap_atto
auto_approve_threshold_atto policy_text whitelist_csv settlement_backend destination_chains_csv
```

For an Arc binding, `delegated_account` is the AgentTreasury vault address, `settlement_backend` is
`arc-vault`, and `destination_chains_csv` lists any additional chains the agent may be paid on. Pass
`none` for an empty list; the settlement chain is added automatically.

```bash
genlayer deploy --contract contracts/genlayer/TreasuryPolicy.py --args \
  0xREGISTRY 0xOWNER 0xAGENT 0xPLATFORM_REPORTER 0xARC_VAULT \
  0x3600000000000000000000000000000000000000 \
  none none 5042002 25000000 100000000 0 \
  "Routine software and infrastructure spending only." \
  none arc-vault 84532
```

After deployment, bind the vault:

```bash
genlayer write 0xPOLICY register_vault --args 0xARC_VAULT \
  0x3600000000000000000000000000000000000000
```

### Registry registration: October 8, 2026

The V6 Arc policy is registered and active in the production registry. Both keys matter here and
they are different accounts:

```text
Registry gateway (registry owner, must sign registration):
0x1072e78B72840BbC921493ea1C97dC5CAA54598F

Owner and Arc policy deployer:
0xEd9EDd8586b20524CafA4F568413C504C9B03172
```

The first attempt failed with `[EXPECTED] Only registry gateway` because the GenLayer CLI's active
account was the owner, not the gateway. Import the gateway key and set it active before registering:

```bash
genlayer account import --name arc-registry-gateway --private-key "$GATEWAY_KEY"
genlayer account use arc-registry-gateway
genlayer write 0x63A045a7B3A1b173525EFFB41B07A59349Cd33D9 register_policy --args \
  0xOWNER 0xAGENT 0xPOLICY 5042002 0xARC_VAULT \
  0x3600000000000000000000000000000000000000 USDC 6 <owner_nonce>
```

For an Arc binding the registry's funding-account slot holds the **vault address**, which is what
`_require_active_registry_binding` compares against the policy. Reading the binding back confirms:

```text
policy=0x704345601942B0e7Ec503BFFD6FACA5f40D746E9
chain=5042002
vault=0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2
token=0x3600000000000000000000000000000000000000
active=true
```

Verify with `npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts registry-binding`.

### Active V6 Arc deployment: October 7, 2026

```text
Policy:
0x704345601942B0e7Ec503BFFD6FACA5f40D746E9

Policy deployment:
0x501645eaf325c5989be10f039b8e720eec1c4a86dd19d75676b6fb57e8c4d66d
```

The deployment reached `FINALIZED` with unanimous validator agreement and
`execution_result: SUCCESS`. Reading state back confirms `contract_version: 6`,
`settlement_backend: arc-vault`, `evm_chain_id: 5042002`, `vault_registered: true`,
`vault_address: 0xB121B87cF9e30293eb619B7eBC0554dfd3018CC2`, and
`allowed_destination_chains: ['5042002', '84532']`.

This policy is **not** registered in the production registry. Registration requires the registry
gateway key, which is the platform signer, and the application performs it server-side during owner
setup. Until it is registered, `_require_active_registry_binding` will reject `queue_request`, so
this policy is contract-level evidence rather than a live agent binding.

### Owner migration

V6 is deployed as a new contract version; existing V5 policies keep working unchanged. To move a
binding to Arc, an owner deploys a new V6 policy, registers it against the existing registry with
the vault address in the `delegated_account` slot, calls `register_vault`, and receives a new agent
API key. Nothing about an existing Base Sepolia policy changes.

### Agent API

`POST /api/v1/spend` accepts an optional `destination_chain` (also `destination_chain_id` or
`destinationChainId`). An unsupported chain id is rejected at the API boundary rather than on chain.
The destination is part of a request's identity, so replaying one `idempotency_key` with a different
destination is refused. Responses carry `route`, `destination_chain`, and a `bridge` object with the
burn hash, attestation status and destination mint hash.
