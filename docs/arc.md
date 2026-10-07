# Arc Settlement And Circle Interoperability

Treasury Copilot settles approved agent payments on Arc using an Arc-native vault contract and a
dedicated Arc executor, and moves USDC to and from Arc with Circle CCTP V2.

Arc is the first settlement environment where Treasury Copilot executes through a contract it
deploys and owns. On Base and Arbitrum the platform redelegates an owner's ERC-7715 MetaMask
permission to the 1Shot relayer (`apps/web/src/lib/oneShot7710.ts`). That path cannot reach Arc:
there is no MetaMask Delegation Framework deployment and no 1Shot capability entry for Arc. Per
`expansion.md`, Arc therefore uses an Arc-native vault with an isolated executor rather than an
unusable delegation.

## Verified network parameters

Verified against the official Circle and Arc documentation on October 3, 2026.
Sources: <https://docs.arc.io/arc/references/rpc-endpoints>,
<https://docs.arc.io/arc/references/contract-addresses>,
<https://docs.arc.io/arc/references/evm-differences>,
<https://developers.circle.com/cctp/evm-smart-contracts>.

| Parameter | Arc Testnet | Arc Mainnet |
| --- | --- | --- |
| Chain ID | `5042002` | `5042` |
| Primary RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| WebSocket | `wss://rpc.testnet.arc.io` | not published |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
| Gas token | Native USDC | Native USDC |
| Currency symbol | USDC | USDC |
| Finality | Sub-second, deterministic | Sub-second, deterministic |
| EVM baseline | Osaka | Osaka |
| Faucet | <https://faucet.circle.com> | Circle point of contact |

Alternate RPC providers for Arc Testnet: Blockdaemon
(`https://rpc.blockdaemon.testnet.arc.io`), dRPC (`https://rpc.drpc.testnet.arc.io`), QuickNode
(`https://rpc.quicknode.testnet.arc.io`). The primary Circle endpoint accepts anonymous requests.

## The two USDC representations

This is the single most important Arc detail for this codebase, and it is a silent-corruption risk
rather than an error-producing one.

| Representation | Address | Decimals | Used for |
| --- | --- | --- | --- |
| Native USDC | n/a (native asset) | **18** | Gas fees, `eth_getBalance`, native value transfer |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | **6** | `IERC20` balances, `transfer`, `approve`, CCTP |

The same address serves both Arc Testnet and Arc Mainnet.

Treasury Copilot settles through the **ERC-20 interface**, so payout amounts stay at **6 decimals**
and remain consistent with Base, Base Sepolia, and Arbitrum Sepolia. No amount-handling refactor is
required for payouts, and `tokenDecimals` on an Arc API key is `6` like every other chain.

The 18-decimal form appears in exactly one place: the **executor's native gas balance**. Any
gas-balance read, display, or low-balance threshold for Arc must use 18 decimals. Mixing the two is
the specific bug Circle's documentation warns about.

## Arc runtime differences that affect this codebase

1. **`maxFeePerGas` floor of 20 Gwei.** The mempool rejects transactions below it, so the Arc wallet
   client must set fees explicitly rather than rely on an estimator that could return less.
2. **`eth_getLogs` is capped at 9,999 blocks per call.** `getExecutionEvents` in
   `apps/web/src/lib/evm.ts` queries `fromBlock: "earliest"`, which fails on Arc. Arc event reads
   must page through history.
3. **`-32014` near the chain head.** The primary endpoint is load balanced and a backend may lag the
   head. Back off briefly and retry rather than treating it as a failure.
4. **`address(0)` transfers revert** instead of succeeding. The vault's zero-address recipient guard
   is therefore load-bearing on Arc, not merely defensive.
5. **Blocklist reverts consume gas without producing a receipt.** Execution-failure handling cannot
   assume a receipt exists for every rejected transaction.
6. **EIP-7708 system emitter** `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` logs all native USDC
   `Transfer` events. Indexing native USDC movement means reading that emitter, not the ERC-20
   contract.
7. **Osaka EVM baseline.** Newer than Shanghai, so solc 0.8.24's default `PUSH0` emission is safe
   and `contracts/evm/foundry.toml` needs no `evm_version` override.
8. **Arc Foundry.** Circle ships `arc-forge` / `arc-cast` / `arc-anvil`, a Foundry fork that handles
   Arc's protocol differences. Use `arc-forge` for Arc deployment and keep standard `forge` for the
   offline test suite. See <https://docs.arc.io/arc/tutorials/install-arc-foundry>.

## CCTP V2

Arc supports CCTP V2 on both testnet and mainnet. V2 contract addresses are deterministic and
therefore **identical on every supported chain**, which keeps the chain registry simple.

| Contract | Testnet (all chains) | Mainnet (all chains) |
| --- | --- | --- |
| `TokenMessengerV2` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| `MessageTransmitterV2` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| `TokenMinterV2` | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | `0xfd78EE919681417d192449715b2594ab58f5D002` |
| `TokenMessengerWithFees` | `0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A` | `0x71f54F818671cD0D7ea140Da213e5C8b5C92a408` |

### Domain IDs

| Chain | Domain |
| --- | --- |
| Ethereum / Ethereum Sepolia | `0` |
| Arbitrum / Arbitrum Sepolia | `3` |
| Base / Base Sepolia | `6` |
| Arc / Arc Testnet | `26` |

### Burn signature

```solidity
depositForBurn(
    uint256 amount,
    uint32  destinationDomain,
    bytes32 mintRecipient,
    address burnToken,
    bytes32 destinationCaller,
    uint256 maxFee,
    uint32  minFinalityThreshold
)
```

`depositForBurnWithHook` appends `bytes hookData`.

`mintRecipient` and `destinationCaller` are left-padded addresses:
`0x` + 24 zeros + the 40-character address body. Amounts and `maxFee` are 6-decimal USDC subunits.

### Two destination-side strategies

- **Direct mint** — call `depositForBurn`, poll for the attestation, then call `receiveMessage` on
  the destination chain. Requires a funded executor and gas on every destination chain.
- **Forwarding Service** — call `depositForBurnWithHook` with forwarding hook data and Circle
  performs the destination-side mint. No destination-chain executor, key, or gas is needed.

Treasury Copilot prefers the **Forwarding Service** for outbound payments, because paying out to an
arbitrary agent-specified chain would otherwise require the platform to hold an executor key and a
gas balance on every chain it can pay to. Direct mint stays available as the fallback for routes
where forwarding is unavailable.

### Circle APIs

Testnet uses the sandbox host `https://iris-api-sandbox.circle.com`; mainnet uses
`https://iris-api.circle.com`.

- **Fees** — `GET /v2/burn/USDC/fees/{sourceDomain}/{destinationDomain}`, with `?forward=true` when
  using the Forwarding Service. `maxFee` must cover the CCTP protocol fee plus any forwarding fee.
- **Attestation** — `GET /v2/messages/{sourceDomain}?transactionHash={burnTxHash}`. The response
  carries `messages[0].message` and `messages[0].attestation` for direct mint, and
  `messages[0].forwardTxHash` once a forwarded transfer has been minted. A `404` means the message
  is not yet indexed and should be retried.

## Gateway

Gateway is deployed on Arc, so unified USDC balances are available.

| Contract | Testnet | Mainnet |
| --- | --- | --- |
| `GatewayWallet` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| `GatewayMinter` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |

## Deployment record

Deployed to Arc Testnet (chain `5042002`) on October 5, 2026. Both receipts returned status `0x1`
in block `65615513`. Deployed and gas-funded by the platform signer
`0x1072e78B72840BbC921493ea1C97dC5CAA54598F`.

| Artifact | Address | Deploy tx |
| --- | --- | --- |
| `AgentTreasury` implementation | `0x4eD45045c4e737287cA75d2d2980DE44a6915eeE` | `0x7aeba37e04458a77641261bba17df7ebdeb84f1038d8f0396df776dbc2ddd3cc` |
| `AgentTreasuryFactory` | `0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB` | `0xae527ceed1363c203df8702451b190f4b21003c2dc098f67a5815c43abd53fcb` |

Standard Foundry 1.7.1 deployed successfully against `https://rpc.testnet.arc.io` without Arc
Foundry. Forge's gas estimate landed at 45–51 gwei, above Arc's 20 gwei floor, and the whole
deployment cost `0.103254344997960408` USDC. Arc Foundry remains the documented tool and is the
right choice if a future deploy hits a protocol-level difference.

Verified independently by RPC read after deployment, not from the broadcast file:

- `factory.treasuryImplementation()` → `0x4eD45045c4e737287cA75d2d2980DE44a6915eeE`
- `factory.tokenMessenger()` → `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (Arc Testnet CCTP V2)
- `implementation.owner()` → zero address, never initialized
- `implementation.initialize(...)` → reverts `already initialized`, confirming the constructor lock

### Smoke vault

| Artifact | Value |
| --- | --- |
| Vault | `0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2` |
| Creation tx | `0xcd79f4bf1af66a7cd25cb183685ebb7ba87fe9ebb6644e5bf38e92bfe2515191` (block `65616183`) |
| Owner / executor | `0x1072e78B72840BbC921493ea1C97dC5CAA54598F` |

This vault is a smoke-test instance owned by the platform signer. Production vaults are created by
the owner's own wallet through the setup flow, so the owner holds withdraw and pause authority and
the platform holds only the executor role.

## Settlement evidence

### Direct settlement on Arc

| Field | Value |
| --- | --- |
| Request id | `0xb312cfcde9774120d8b2c74cb6ea71424317feb4a24d857a257ddbce08cb698a` |
| Vault funding tx | `0x36c865c3c4cf56a739c0fd8eee62bb29df414aaec9e2a08ceed69345b94549df` (5.000000 USDC) |
| Payout tx | `0x8d110af840fa986ec9bd654b4519cfa6b4b6970f46f403fde984015a3ac9e6db` (block `65616740`) |
| Recipient | `0xEd9EDd8586b20524CafA4F568413C504C9B03172` |
| Amount | 1.000000 USDC, balance `59.639089` → `60.639089` |

### Cross-chain settlement, Arc to Base Sepolia via CCTP V2 Forwarding Service

| Field | Value |
| --- | --- |
| Request id | `0xe2d7a46f8f084d7f9c4c3803a5b207f96ff1f1ccf03b9636293d613687a6fb14` |
| Burn tx (Arc) | `0x414ef53f33a270d5c3700463a34375187933074f580a85e7734f4a7a955d7825` (block `65618693`) |
| Mint tx (Base Sepolia) | `0x76e11654004203dfd69b8e7df45ad7bb76a95f737274b12e9ab7fea506d3ffe0` (block `47715915`) |
| Destination domain | `6` |
| `maxFee` / `minFinalityThreshold` | `54662` / `1000` |
| `hookData` | `0x636374702d666f72776172640000000000000000000000000000000000000000` (`"cctp-forward"`) |

The mint transaction called `MessageTransmitterV2`
(`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`) and emitted two USDC mints on Base Sepolia:

- `500000` (0.500000 USDC) to the recipient — the full principal, undiminished
- `54662` (0.054662 USDC) to Circle's forwarder `0xc17d06b66fb2f308bb3af99231a45380a28563a2`

Vault accounting moved exactly as designed: `feeReserve` `200000` → `145338` (−`54662`, the fee)
and `availableBalance` `3800000` → `3300000` (−`500000`, the principal). This confirms the model
where principal is drawn from unreserved balance, the CCTP fee is drawn from the bounded reserve,
and the burn total is principal plus fee so the payee receives the amount the policy approved.

The Iris API returned `status: complete` with a `forwardTxHash` on the first poll, so Arc's
sub-second finality plus the Forwarding Service made this effectively synchronous.

### Guards verified against the live chain

Confirmed by `eth_call` against the deployed vault:

| Attempt | Result |
| --- | --- |
| Replay an already-settled request id | reverts `already executed` |
| `payout` from a non-executor | reverts `not executor` |
| `payoutCrossChain` with an unfunded fee reserve | reverts `insufficient fee reserve` |
| `initialize` on the implementation | reverts `already initialized` |

Replay protection is shared between `payout` and `payoutCrossChain`, so one approved request can
never be both settled locally and bridged.

## Policy V6

GenLayer policy V6 is what lets an agent-submitted request settle on Arc. V5 stores an ERC-7715
delegation and has no way to express a vault or a destination chain, so an Arc binding could not be
registered at all.

V6 adds a `settlement_backend` (`delegated-7710` or `arc-vault`), a `vault_address` with a
`register_vault` write, an owner-controlled destination-chain allowlist, a per-request
`destination_chain_id` and `route`, and independent `bridge_tx_hash` / `attestation_status` /
`destination_tx_hash` lifecycle fields.

A destination outside the owner's allowlist is denied deterministically, before any LLM review
runs. That ordering is verified by `scripts/policy_v6_harness.py`, which loads the real contract
source under stubbed GenVM primitives and asserts the prompt function is never reached for a
denied destination.

See [deployment](deployment.md) for the V6 constructor arguments and the owner migration steps.

## Mainnet status

Arc Mainnet is **not enabled**. Consistent with `docs/deployment.md`, enabling real-fund settlement
additionally requires a separate registry, registry gateway key, GenLayer reporter key, Arc executor
key, API secrets, cron worker, server-side feature flags, and a contract security review. A live
network and a verified contract address are not sufficient on their own.
