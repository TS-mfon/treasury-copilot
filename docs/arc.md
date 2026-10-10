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

## CCTP payout destinations

An approved payment can be delivered to any chain Circle supports, out of the Arc vault. These
chains are payout destinations only: they can receive a mint but never hold a treasury, so
`settlementBackendForChainId` refuses them and a policy cannot be bound to one.

<!-- BEGIN:cctp-destinations -->
<!-- Generated by scripts/gen-network-tables.mjs — edit the chain registry, not this table. -->

**Mainnet** — Circle's production attestation service (`iris-api.circle.com`).

| Network | Chain ID | CCTP domain | Role | USDC |
| --- | ---: | ---: | --- | --- |
| Ethereum | `1` | 0 | Destination | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Avalanche | `43114` | 1 | Destination | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| OP Mainnet | `10` | 2 | Destination | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Arbitrum One | `42161` | 3 | Destination | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base Mainnet | `8453` | 6 | Settlement + destination | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Polygon PoS | `137` | 7 | Destination | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Unichain | `130` | 10 | Destination | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` |
| Linea | `59144` | 11 | Destination | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` |
| Codex | `81224` | 12 | Destination | `0xd996633a415985DBd7D6D12f4A4343E31f5037cf` |
| Sonic | `146` | 13 | Destination | `0x29219dd400f2Bf60E5a23d13Be72B486D4038894` |
| World Chain | `480` | 14 | Destination | `0x79A02482A880bCe3F13E09da970dC34dB4cD24D1` |
| Monad | `143` | 15 | Destination | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Sei | `1329` | 16 | Destination | `0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392` |
| XDC | `50` | 18 | Destination | `0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1` |
| HyperEVM | `999` | 19 | Destination | `0xb88339CB7199b77E23DB6E890353E22632Ba630f` |
| Ink | `57073` | 21 | Destination | `0x2D270e6886d130D724215A266106e6832161EAEd` |
| Plume | `98866` | 22 | Destination | `0x222365EF19F7947e5484218551B56bb3965Aa7aF` |
| Arc | `5042` | 26 | Settlement + destination | `0x3600000000000000000000000000000000000000` |

**Testnet** — Circle's sandbox attestation service (`iris-api-sandbox.circle.com`).

| Network | Chain ID | CCTP domain | Role | USDC |
| --- | ---: | ---: | --- | --- |
| Ethereum Sepolia | `11155111` | 0 | Destination | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Avalanche Fuji | `43113` | 1 | Destination | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| OP Sepolia | `11155420` | 2 | Destination | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |
| Arbitrum Sepolia | `421614` | 3 | Settlement + destination | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Base Sepolia | `84532` | 6 | Settlement + destination | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Polygon Amoy | `80002` | 7 | Destination | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |
| Unichain Sepolia | `1301` | 10 | Destination | `0x31d0220469e10c4E71834a79b1f276d740d3768F` |
| Linea Sepolia | `59141` | 11 | Destination | `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7` |
| Codex Testnet | `812242` | 12 | Destination | `0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f` |
| World Chain Sepolia | `4801` | 14 | Destination | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` |
| Monad Testnet | `10143` | 15 | Destination | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Sei Testnet | `1328` | 16 | Destination | `0x4fCF1784B31630811181f670Aea7A7bEF803eaED` |
| Ink Sepolia | `763373` | 21 | Destination | `0xFabab97dCE620294D2B0b0e46C68964e326300Ac` |
| Arc Testnet | `5042002` | 26 | Settlement + destination | `0x3600000000000000000000000000000000000000` |

<!-- END:cctp-destinations -->

A testnet shares its mainnet domain, so the domain alone does not identify a chain. The attestation
host is what separates them, and a route whose endpoints disagree on that host is refused outright
rather than burned — Circle would never attest it.

### Why X Layer is not here

X Layer (domain 37) supports CCTP but **not** Circle's Forwarding Service. Confirmed directly:

```bash
curl -s "https://iris-api.circle.com/v2/burn/USDC/fees/26/37?forward=true"
# -> {"error":"Destination domain not supported for forwarding"}
```

Treasury Copilot's vault calls `depositForBurnWithHook` with the forwarding hook precisely so that
Circle performs the destination mint and the platform needs no key and no gas on the destination
chain. Without forwarding, a burn to X Layer would succeed on Arc and the payee would never be
credited. So X Layer was removed from the registry and the codebase rather than listed as a
destination that silently loses money.

Interestingly, the sandbox *does* return a forwarding fee for domain 37 while production does not.
That asymmetry is the reason the destination set is verified per environment against the live fee
API (`scripts/verify-cctp-candidates.mts`) instead of assuming testnet and mainnet match. X Layer
stays in that script as a negative control: if the check ever stops failing for it, the check is
broken.

## How a cross-chain payment runs

1. The agent submits a request naming a `destination_chain`.
2. GenLayer checks the destination against the owner's allowlist. A destination outside it is a
   deterministic denial recorded before any policy review runs.
3. On approval, the executor quotes the fee from Circle's live endpoint and calls
   `payoutCrossChain`, burning principal plus `maxFee` so the deduction still leaves the payee
   whole. The fee comes from the vault's bounded reserve, never the approved principal.
4. The burn is recorded as a bridge initiation, not an execution — the payee has not been credited.
5. The cron bridge stage polls the attestation and closes the request only once Circle reports the
   destination mint. A request that already carries a destination transaction is a no-op, so a
   duplicate worker cannot double-record.

Verified end to end: `npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts settle-cross-chain`
burns on Arc through the application's own executor and asserts the destination mint credited the
payee exactly the principal.

## Inbound funding

`POST /api/owner/fund-arc` returns the approval and `depositForBurn` calldata for the owner to sign
in their own wallet. The platform never holds authority over the owner's source-chain USDC, and with
the Forwarding Service the owner signs only on the source chain.

## Gateway

Gateway is deployed on Arc, so unified USDC balances are available.

| Contract | Testnet | Mainnet |
| --- | --- | --- |
| `GatewayWallet` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| `GatewayMinter` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |

## Deployment record

<!-- BEGIN:deployed-contracts -->
<!-- Generated by scripts/gen-network-tables.mjs — edit the chain registry, not this table. -->

Contracts this project deploys and owns:

| Network | Chain ID | Contract | Address |
| --- | ---: | --- | --- |
| Arc Testnet | `5042002` | AgentTreasury (implementation) | [`0x4eD45045c4e737287cA75d2d2980DE44a6915eeE`](https://explorer.testnet.arc.io/address/0x4eD45045c4e737287cA75d2d2980DE44a6915eeE) |
| Arc Testnet | `5042002` | AgentTreasuryFactory | [`0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB`](https://explorer.testnet.arc.io/address/0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB) |
| Arc | `5042` | AgentTreasury (implementation) | [`0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7`](https://explorer.arc.io/address/0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7) |
| Arc | `5042` | AgentTreasuryFactory | [`0x450B2D9dad4C72B43620688ef9626F98540CA808`](https://explorer.arc.io/address/0x450B2D9dad4C72B43620688ef9626F98540CA808) |

Each owner's treasury is a minimal-proxy clone deployed by the factory above, so its address is
specific to that owner and is shown in the app after setup. The implementation is locked in its
constructor and reverts `already initialized` if called directly, so only clones are usable.

Protocol contracts called but not owned by this project. Circle deploys CCTP v2 at the same
address on every supported chain, so these are constants rather than per-chain configuration:

| Contract | Address |
| --- | --- |
| CCTP v2 TokenMessenger (mainnet) | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| CCTP v2 MessageTransmitter (mainnet) | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| CCTP v2 TokenMessenger (testnet) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP v2 MessageTransmitter (testnet) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Arc USDC (ERC-20 interface, both Arc chains) | `0x3600000000000000000000000000000000000000` |

<!-- END:deployed-contracts -->

### Arc Testnet

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

### Arc Mainnet

Deployed to Arc Mainnet (chain `5042`) on October 10, 2026, from the key in `~/.env.key`
(`0x9876d9D55D21cACA1bE262AE28cF26C4d0e0bD8b`). Standard Foundry again, no Arc Foundry needed.

| Artifact | Address |
| --- | --- |
| `AgentTreasury` implementation | [`0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7`](https://explorer.arc.io/address/0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7) |
| `AgentTreasuryFactory` | [`0x450B2D9dad4C72B43620688ef9626F98540CA808`](https://explorer.arc.io/address/0x450B2D9dad4C72B43620688ef9626F98540CA808) |

Preconditions checked before spending anything, each against the chain rather than a document:

- `eth_chainId` → `0x13b2` (5042), so the RPC is really Arc Mainnet
- deployer native balance → `400000000000000000` (0.4 USDC at 18 decimals)
- Circle's mainnet `TokenMessengerV2` at `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` has code on Arc
- Arc USDC `decimals()` → `6`

Verified after deployment by RPC read, not from the broadcast file:

- `factory.treasuryImplementation()` → `0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7`
- `factory.tokenMessenger()` → `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (Arc Mainnet CCTP V2)
- `implementation` has bytecode
- `implementation.initialize(...)` → reverts `already initialized`, confirming the constructor lock

Reproduce the whole check with:

```bash
npx tsx --tsconfig apps/web/tsconfig.json scripts/verify-cctp.mts mainnet-on
```

That gate replaced the earlier `mainnet-off` gate. The old one asserted Arc Mainnet was absent from
the allowlist, which would have made enabling mainnet a one-line edit that silently contradicted a
passing check. The new one asserts the properties that actually make real-fund settlement safe: the
configured factory is the deployed one, its implementation is locked, its TokenMessenger matches the
registry, the mainnet executor key is distinct from both the testnet executor and the platform
signer, and the testnet path still works.

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

Arc Mainnet is **enabled for vault deployment and funding, and gated for payout signing.**

What works now: chain `5042` is in `ALLOWED_EVM_CHAIN_IDS`, the contracts above are deployed and
verified, `NEXT_PUBLIC_ARC_VAULT_FACTORY` points at the live factory, and an owner can deploy a
vault, fund it from their wallet, and fund it cross-chain over CCTP from any supported mainnet.

What is still gated: signing a payout requires `ARC_MAINNET_EXECUTOR_PRIVATE_KEY`, which **does not
fall back** to `ARC_EXECUTOR_PRIVATE_KEY`. The duplication is the point. A deployment already
configured for Arc Testnet would otherwise begin signing real-USDC payouts with a key that was
generated, funded and handled as a testnet key, and nothing in the logs would mark the change.
Requiring a separate variable makes reusing one key something a person has to write down by setting
both to the same value, rather than something that happens by default.

That key must also be funded with Arc USDC for gas, and must differ from the platform signer — the
same signer-separation rule the testnet executor follows, enforced in `arcExecutorAccount` and
checked by the `mainnet-on` gate.

Still outstanding before treating mainnet as production-grade, carried over unchanged from
`docs/deployment.md`: a separate registry and registry gateway key, a separate GenLayer reporter
key, isolated API secrets, a dedicated cron worker, and a contract security review. A live network
and a verified contract address are not sufficient on their own.
