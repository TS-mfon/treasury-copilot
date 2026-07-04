# Treasury Copilot

Fresh implementation of the Treasury Copilot plan. This repo intentionally does
not reuse the existing local frontend or the companion Contract-to-English app.

## Guarantees

- No database for request history.
- No mocked balances or seeded request history.
- All dashboard state is read live from GenLayer or the selected EVM chain.
- 1Shot execution uses the hosted relayer URL mode.
- The GenLayer contract uses a pinned runner, not `py-genlayer:test` or `latest`.

## Layout

- `apps/web` - Next.js setup wizard, policy editor, dashboard, and agent submitter.
- `apps/relay` - optional stateless forwarding boundary for approved 1Shot relayer payloads.
- `contracts/evm` - legacy Foundry treasury clone contracts and tests.
- `contracts/genlayer` - per-user GenLayer `TreasuryPolicy.py` and discovery registry.
- `packages/shared` - chain config, ABIs, EIP-712 helpers, and shared types.

## First Build Order

1. Fill `.env.local` files from `.env.example`.
2. Run `npm install`.
3. Run `npm run typecheck`.
4. Run `forge test --root contracts/evm`.
5. Run `genvm-lint check contracts/genlayer/TreasuryPolicy.py`.
6. Prove Base Sepolia E2E before Arbitrum Sepolia or X Layer mainnet.

## Request Flow

The owner connects MetaMask, grants a weekly USDC delegation to the platform
agent signer, and deploys a per-user GenLayer policy with that delegation
context. Agent payloads are signed by the server-held platform wallet so one
authorized wallet submits for all configured agents. GenLayer checks every
request against the signer, caps, weekly aggregate, whitelist, and policy text.
Agent submissions go through the backend once. The backend signs with the
platform wallet, submits to GenLayer, and when GenLayer approves, immediately
forwards the approved 1Shot relayer payload and records the tx hash. Denied
requests are stored with reasoning and no funds move.

## 1Shot Hosted Relayer

Use hosted relayer URL mode, not client-credential mode:

```bash
NEXT_PUBLIC_ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers
ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers
```

The backend still validates policy, chain, delegated account, token, permission
context, recipient, amount, and request id before forwarding approved GenLayer
payloads to 1Shot.
