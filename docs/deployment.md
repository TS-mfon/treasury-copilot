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
  5000000 \
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

### Example A: auto-approved request

Amount below the auto-approval threshold. Expected result:

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

Amount above the auto-approval threshold but below the cap. Expected result:

```text
FINALIZED
execution success
verdict=approved or denied according to validator consensus
reasoning is present
finalized=true only after the finalized receipt marker
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

### StudioNet release evidence: July 22, 2026

The current release was validated against:

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

Finalized request evidence:

| Case | Request ID | Verdict | Reason |
| --- | --- | --- | --- |
| 4 USDC | `0xa950cc8c9896290e9d4ad01c12244ef04f248c2c85f40ed5fbf498f7648997a5` | approved | Within auto-approve threshold |
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
```

The operator address must equal the address derived from `AGENT_SIGNER_PRIVATE_KEY`. The registry address must be the fresh successful deployment.

Base Mainnet configuration is environment-aware but must remain execution-disabled until `relayer_getCapabilities(["8453"])` returns a valid target address, fee collector, and USDC token entry. On July 24, 2026, the live 1Shot endpoint returned an empty capability object for Base Mainnet and a valid USDC capability for Base Sepolia.

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

`/api/cron/execute` requires `Authorization: Bearer $CRON_SECRET`. It only scans finalized approved requests and revalidates policy/registry identity before execution. The standalone `apps/relay` process only calls this authenticated endpoint at `/run`; it does not accept recipient, amount, delegation, or policy payloads.

The Vercel schedule is a recovery mechanism. The spend route attempts immediate execution after finality, so the system does not depend on a daily cron for normal operation.

## 9. Post-deploy smoke

1. Open the landing page.
2. Connect and authenticate a wallet.
3. Open setup and confirm Base Sepolia/USDC.
4. Verify unsupported wallets receive the ERC-7715 capability error before signing.
5. Configure a real delegation with a small test amount.
6. Create one auto-approved API request.
7. Poll `/api/v1/requests/:id`.
8. Confirm `tx_hash` and explorer link.
9. Test a denied cap request.
10. Rotate the API key and verify the old key returns `invalid_api_key`.
11. Revoke the agent and verify balance/history endpoints reject the old binding.
