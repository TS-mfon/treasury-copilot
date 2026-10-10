# Arc Testnet Testing Guide

How to confirm for yourself that Arc settlement works. Every step is something you run or open —
none of it depends on trusting a report.

Production app: <https://treasurycopilot.app>

## Deployed addresses

| What | Address |
| --- | --- |
| `AgentTreasury` implementation | [`0x4eD45045c4e737287cA75d2d2980DE44a6915eeE`](https://explorer.testnet.arc.io/address/0x4eD45045c4e737287cA75d2d2980DE44a6915eeE) |
| `AgentTreasuryFactory` | [`0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB`](https://explorer.testnet.arc.io/address/0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB) |
| Smoke vault | [`0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2`](https://explorer.testnet.arc.io/address/0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2) |
| Arc executor | [`0xA3bb5f926acf42460217CD1f0A88D427e5cb438b`](https://explorer.testnet.arc.io/address/0xA3bb5f926acf42460217CD1f0A88D427e5cb438b) |
| Arc USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` |

## Test 1: the deployment knows about Arc

```bash
curl -s https://treasurycopilot.app/api/health | jq
```

Expect `"status": "healthy"`, `"arc_testnet": "configured"` under `checks`, and a
`settlement_chains` array containing Arc Testnet with `"backend": "arc-vault"` and
`"cctp_domain": 26`, alongside Base Sepolia with `"backend": "delegated-7710"`.

If `arc_testnet` reads `missing:...` it names exactly which piece of configuration is absent.
If it reads `disabled`, `ARC_SETTLEMENT_ENABLED` is off.

## Test 2: the contracts are real and correctly wired

Open the factory on the [Arc explorer](https://explorer.testnet.arc.io/address/0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB)
and confirm it has bytecode, or check it from the command line:

```bash
cast call 0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB 'treasuryImplementation()(address)' \
  --rpc-url https://rpc.testnet.arc.io
# -> 0x4eD45045c4e737287cA75d2d2980DE44a6915eeE

cast call 0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB 'tokenMessenger()(address)' \
  --rpc-url https://rpc.testnet.arc.io
# -> 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA   (Circle's Arc Testnet CCTP V2)
```

The implementation must refuse to be initialized directly — only clones are usable:

```bash
cast call 0x4eD45045c4e737287cA75d2d2980DE44a6915eeE \
  'initialize(address,address,address,address)' \
  0x0000000000000000000000000000000000000001 \
  0x0000000000000000000000000000000000000001 \
  0x3600000000000000000000000000000000000000 \
  0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA \
  --rpc-url https://rpc.testnet.arc.io
# -> execution reverted: already initialized
```

## Test 3: run the automated verification suite

From the repository root, on the `arc-settlement` branch:

```bash
npx tsx scripts/verify-arc.mts executor         # key is valid, funded, and not the platform signer
npx tsx scripts/verify-arc.mts factory          # configured factory is the deployed one
npx tsx scripts/verify-arc.mts chain-allowlist  # Arc allowed, Base Sepolia retained
npx tsx scripts/verify-arc.mts vault-executor   # vault names the Arc executor, owner is separate
npx tsx scripts/verify-arc.mts docs             # every Arc variable is documented
npx tsx scripts/verify-arc.mts no-secrets       # no secret value is in any tracked file
npx tsx scripts/verify-arc.mts deployment       # live deployment advertises Arc
```

Each prints `ARC_VERIFY_OK <mode>` and exits zero only when every assertion inside it passed.

## Test 4: make a real payment on Arc

This is the one that matters. It settles 0.01 USDC through the application's own executor module
(`apps/web/src/lib/arcVault.ts`), not through a test script's own copy of the logic:

```bash
npx tsx scripts/verify-arc.mts settle
```

It prints the Arc transaction hash, asserts the recipient's balance moved by **exactly** 10000
base units, and asserts the request id is now recorded as executed on chain. Open the printed hash
on <https://explorer.testnet.arc.io> to see it.

To watch the balance move yourself:

```bash
RECIPIENT=0xEd9EDd8586b20524CafA4F568413C504C9B03172
cast call 0x3600000000000000000000000000000000000000 'balanceOf(address)(uint256)' $RECIPIENT \
  --rpc-url https://rpc.testnet.arc.io
# run the settle command, then run this again — it should rise by exactly 10000
```

## Test 5: the safety properties actually hold

These are read-only simulations, so they cost nothing and change nothing:

```bash
VAULT=0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2
EXEC=0xA3bb5f926acf42460217CD1f0A88D427e5cb438b
RECIP=0xEd9EDd8586b20524CafA4F568413C504C9B03172
RPC=https://rpc.testnet.arc.io

# A stranger cannot move money.
cast call $VAULT 'payout(bytes32,address,uint256)' $(cast keccak "x") $RECIP 10000 \
  --from $RECIP --rpc-url $RPC
# -> execution reverted: not executor

# A bridge payout cannot run without a funded fee reserve.
cast call $VAULT 'payoutCrossChain(bytes32,address,uint256,uint32,uint256,uint32,bytes)' \
  $(cast keccak "y") $RECIP 10000 6 500 1000 0x --from $EXEC --rpc-url $RPC
# -> execution reverted: insufficient fee reserve

# Replay a request id you already settled in Test 4 (substitute the printed id).
cast call $VAULT 'payout(bytes32,address,uint256)' <REQUEST_ID_FROM_TEST_4> $RECIP 10000 \
  --from $EXEC --rpc-url $RPC
# -> execution reverted: already executed
```

Replay protection is shared between the local and cross-chain paths, so one approved request can
never be both paid on Arc and bridged.

## Test 6: cross-chain payment to another network

Already proven once on chain, and reproducible. The vault burns principal plus the CCTP fee so the
payee receives the full approved amount, and Circle's Forwarding Service performs the destination
mint, which is why no executor or gas is needed on the destination chain.

Reference transfer from the verified run:

- Burn on Arc: [`0x414ef53f…955d7825`](https://explorer.testnet.arc.io/tx/0x414ef53f33a270d5c3700463a34375187933074f580a85e7734f4a7a955d7825)
- Mint on Base Sepolia: [`0x76e11654…06d3ffe0`](https://sepolia.basescan.org/tx/0x76e11654004203dfd69b8e7df45ad7bb76a95f737274b12e9ab7fea506d3ffe0)
- Recipient received `500000` (0.5 USDC); Circle's forwarder took `54662` (0.054662 USDC)

To check Circle's view of any burn:

```bash
curl -s "https://iris-api-sandbox.circle.com/v2/messages/26?transactionHash=<BURN_TX>" | jq
# status "complete" plus a forwardTxHash means the destination mint is done
```

Current fees for Arc → Base Sepolia:

```bash
curl -s "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/6?forward=true" | jq
```

## Test 7: nothing on Base Sepolia regressed

The existing pilot must behave exactly as before. The health endpoint should still show
`base_sepolia` and `one_shot` configured, and `settlement_chains` should still list Base Sepolia
with `delegated-7710`. Run your normal agent flow against `POST /api/v1/spend` and confirm it
still settles through the 1Shot relayer as it always has.

The full suites:

```bash
npm run test -w apps/web   # 71 tests
npm run test:evm           # 35 tests
npm run typecheck
npm run lint
```

## Test 8: destination chains on the agent API

Once an Arc-bound V6 policy is registered, `POST /api/v1/spend` accepts a `destination_chain`:

```bash
curl -X POST https://treasurycopilot.app/api/v1/spend \
  -H "authorization: Bearer $AGENT_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "agent": "0xYOUR_AGENT",
    "recipient": "0xPAYEE",
    "amount": "1.00",
    "category": "infrastructure",
    "justification": "monthly observability invoice",
    "idempotency_key": "inv-2026-10-001",
    "destination_chain": 84532
  }'
```

Omit `destination_chain` to settle on the policy's own chain. An unsupported chain id is rejected
immediately with a clear error. Replaying the same `idempotency_key` with a different
`destination_chain` is refused, so an approved key cannot be redirected to another chain. The
response carries `route`, `destination_chain` and a `bridge` object with the burn hash, attestation
status and destination mint hash.

## Test 9: pay out to another chain

With an Arc-bound policy registered, name any CCTP-supported chain in the request:

```bash
curl -X POST https://treasurycopilot.app/api/v1/spend \
  -H "authorization: Bearer $AGENT_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "agent": "0xYOUR_AGENT",
    "recipient": "0xPAYEE",
    "amount": "1.00",
    "category": "infrastructure",
    "justification": "monthly observability invoice",
    "idempotency_key": "inv-2026-10-009",
    "destination_chain": 84532
  }'
```

Poll `/api/v1/requests/:id`. A cross-chain request moves through `route: "cctp"` with
`execution_status` going `executing` → `bridging` → `executed`, and the `bridge` object filling in
the burn hash, then the attestation status, then the destination mint hash. The request is only
`executed` once Circle has minted, because the burn alone is not the payee's receipt.

Supported destinations and their CCTP domains are listed in [docs/arc.md](arc.md). Payable testnet
chains are Arc Testnet (26), Base Sepolia (6), Arbitrum Sepolia (3), Ethereum Sepolia (0),
OP Sepolia (2) and Polygon Amoy (7).

To drive the whole thing yourself without the agent API:

```bash
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts settle-cross-chain
```

That burns on Arc through the application's own executor, polls Circle, and asserts the destination
mint credited the payee **exactly** the principal. It prints both hashes.

## Test 10: fund the Arc vault from another chain

```bash
curl -X POST https://treasurycopilot.app/api/owner/fund-arc \
  -H "content-type: application/json" \
  --cookie "$OWNER_SESSION_COOKIE" \
  -d '{"source_chain": 11155111, "vault": "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2", "amount": "5000000"}'
```

It returns two transactions for you to sign in your own wallet — an approval and a
`depositForBurn` whose mint recipient is the vault. The platform never touches your source-chain
USDC. `total_amount_units` is the principal plus the CCTP fee, so the vault receives the full
`amount_units`. An unsupported source chain is refused with the exact stage named.

## Test 11: Gateway and chain configuration

```bash
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts gateway
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts registry
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts registry-binding
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts mainnet-off
```

`gateway` reads contract code on Arc rather than trusting config, and checks a chain with no Gateway
deployment reports `not-deployed` instead of a false positive. `registry` asks Circle's live fee
service to confirm every Arc route the registry claims, and reads Arc USDC's decimals on chain.
`registry-binding` confirms the Arc policy is active in the production registry with the vault in
the funding slot. `mainnet-off` confirms Arc mainnet is still disabled.

## Test 12: set up your own Arc agent

Open [the setup page](https://treasurycopilot.app/setup), connect your wallet, and pick **Arc
Testnet**. Instead of a MetaMask permission request you get **Deploy agent treasury vault** — you
deploy a vault you own and the platform executor is named on it. Optionally list additional payout
chain ids. Then **Register vault** to deploy the V6 policy, register it, bind the vault and receive
an agent API key.

You keep withdraw and pause authority on the vault. The executor can only pay out requests GenLayer
has already approved, which you can confirm with the read-only reverts in Test 5.

## Test 13: read a request's outcome

Open `/history` to see every request across your policies. The status column reads in plain terms:
**Accepted / Executed** means the payee was paid, **Denied** means the policy refused it and nothing
moved, **Bridging to destination** means the burn happened and Circle has not yet minted. A denied
row never shows a transaction, because nothing was ever sent on chain.

Select a row in `/history` to expand its detail, including the recipient, the destination chain and
the settlement transaction.

When the outcome is **Denied**, `GET /api/v1/requests/:id` returns a machine-readable
`denial_code`:

| denial_code | What it means | Who fixes it |
| --- | --- | --- |
| `recipient_not_approved` | The payee is not on the policy's whitelist | Owner, in `/policy` |
| `evidence_required` | The invoice or evidence was missing or already used | Agent |
| `amount_above_cap` | Above the per-transaction cap, or zero | Agent |
| `weekly_cap_exhausted` | The weekly budget is spent | Wait for the window to reset |
| `destination_not_permitted` | That chain is not permitted for this policy | Owner |
| `policy_text_rejected` | The comparative review judged it against your policy text | Owner rewrites the policy, or the agent improves the request |

`policy_text_rejected` is the only one without a finer cause, because that review compares a single
boolean so validators can agree — a free-form reason from it could not be trusted.

## Test 14: the operator console

`/admin` is not linked in the navigation; type the URL. It requires the owner session and the
`ADMIN_WALLET_ALLOWLIST`. The request stream is clickable — select any row to inspect the recipient,
destination chain, reconciliation state and settlement transaction, or to copy the request id.

It is unlinked because it is an operator surface, not because it is secret. Access control is the
session plus the allowlist, not the absence of a link.

## What does not work yet

**Arc Mainnet is deliberately off.** It needs a separate registry, gateway key, reporter key,
executor key, API secrets, cron worker, feature flags, and a contract security review first. The
`mainnet-off` check above exists to keep it that way.

**The GenLayer policy allowlist is permissive by default.** `ALLOWED_GENLAYER_POLICY_ADDRESSES` is
now genuinely enforced, but an empty list still means unrestricted so existing deployments keep
working. Set it to the policies you expect if you want it to bite.

Everything else in Tests 1 through 12 exercises real production code against live networks. None of
it is a mock.
