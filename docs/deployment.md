# Deployment Notes

## EVM

The Foundry deploy script deploys a fresh `Treasury` implementation and
`TreasuryFactory`.

Current testnet deployments:

- Base Sepolia implementation: `0xc90197fBAe660e0f4b091b4f5E0215fEE0336A67`
- Base Sepolia factory: `0x67E043731d26A7D27C00Bc3389F01162Cb18007d`
- Base Sepolia treasury clone: `0xD3d0eD2DECe4A89B8BD31b4a793D95a0B80Ac87D`
- Arbitrum Sepolia implementation: `0x91CA91e14764c7c3E2380e1ffd4A87C782533D58`
- Arbitrum Sepolia factory: `0xA51967311426BC4281A90Ebe24EF786eC942dA01`
- Arbitrum Sepolia treasury clone: `0xdf8F907A31Fe60A8d288Ce809D16Fd4c03B93c02`

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

Current StudioNet policy: `0xAFd5b16d1ed031F60294C378924267c03De6ccc0`

## 1Shot Relay

The relay is stateless. It requires:

- `ONE_SHOT_CLIENT_ID`
- `ONE_SHOT_CLIENT_SECRET`
- `ONE_SHOT_BASE_URL`
- `ALLOWED_GENLAYER_POLICY_ADDRESSES`
- `ALLOWED_EVM_CHAIN_IDS`

It does not store requests or transaction history.
