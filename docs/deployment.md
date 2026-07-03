# Deployment Notes

## EVM

The Foundry deploy script deploys a fresh `Treasury` implementation and
`TreasuryFactory`.

Required environment:

- `PRIVATE_KEY`
- `BASE_SEPOLIA_RPC_URL` or `ARBITRUM_SEPOLIA_RPC_URL`
- `ETHERSCAN_API_KEY` for verification

Example:

```bash
forge script script/DeployTreasuryFactory.s.sol \
  --root contracts/evm \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

## GenLayer

`contracts/genlayer/TreasuryPolicy.py` must pass:

```bash
genvm-lint check contracts/genlayer/TreasuryPolicy.py
```

Deployment should target StudioNet first:

```bash
genlayer network set studionet
genlayer deploy --contract contracts/genlayer/TreasuryPolicy.py --args ...
```

## 1Shot Relay

The relay is stateless. It requires:

- `ONE_SHOT_CLIENT_ID`
- `ONE_SHOT_CLIENT_SECRET`
- `ONE_SHOT_BASE_URL`
- `ALLOWED_GENLAYER_POLICY_ADDRESSES`
- `ALLOWED_EVM_CHAIN_IDS`

It does not store requests or transaction history.

