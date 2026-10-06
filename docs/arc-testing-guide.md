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

## What does not work yet

**An agent cannot yet submit an Arc payment over HTTP.** `POST /api/v1/spend` still requires a
GenLayer policy, and the policy contract is at version 5, which stores an ERC-7715 delegation and
has no field for a vault address or a per-request destination chain. Policy V6 is the next step.

So today: the Arc contract, the executor, the routing, direct Arc settlement and CCTP cross-chain
settlement are all live and verifiable. The agent-facing HTTP path on Arc is not. Everything in
Tests 1 through 6 exercises the real production code; none of it is a mock.

Arc Mainnet is deliberately off. It needs a separate registry, gateway key, reporter key, executor
key, API secrets, cron worker, feature flags, and a contract security review first.
