# Treasury Copilot

Fresh implementation of the Treasury Copilot plan. This repo intentionally does
not reuse the existing local frontend or the companion Contract-to-English app.

## Guarantees

- No database.
- No mocked balances or seeded request history.
- All dashboard state is read live from GenLayer or the selected EVM chain.
- 1Shot credentials stay server-side in the stateless relay.
- The GenLayer contract uses a pinned runner, not `py-genlayer:test` or `latest`.

## Layout

- `apps/web` - Next.js setup wizard, policy editor, dashboard, and agent submitter.
- `apps/relay` - stateless 1Shot bearer-token and approved-payout execution boundary.
- `contracts/evm` - Foundry treasury clone contracts and tests.
- `contracts/genlayer` - GenLayer `TreasuryPolicy.py`.
- `packages/shared` - chain config, ABIs, EIP-712 helpers, and shared types.

## First Build Order

1. Fill `.env.local` files from `.env.example`.
2. Run `npm install`.
3. Run `npm run typecheck`.
4. Run `forge test --root contracts/evm`.
5. Run `genvm-lint check contracts/genlayer/TreasuryPolicy.py`.
6. Prove Base Sepolia E2E before Arbitrum Sepolia or X Layer mainnet.

## Request Flow

The agent submits spend requests to GenLayer first. GenLayer checks the
authorized agent, caps, weekly aggregate, whitelist, and policy text. Approved
requests return a 1Shot relay payload for the delegated treasury payout path;
denied requests are stored with reasoning and no funds move.
