# Deployment Notes

## EVM Legacy Clone Contracts

The Foundry deploy script deploys the legacy `Treasury` implementation and
`TreasuryFactory`. The current primary user flow uses MetaMask delegation from
the user's wallet/smart account, not manual user funding of a clone.

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

Current StudioNet policy: redeploy after changing `TreasuryPolicy.py`; update
`NEXT_PUBLIC_GENLAYER_POLICY` and `ALLOWED_GENLAYER_POLICY_ADDRESSES`.

## 1Shot Relay

Use hosted 1Shot relayer URL mode, not client-credential mode. The relay is
stateless and requires:

- `AGENT_SIGNER_PRIVATE_KEY` or `TREASURY_OPERATOR_PRIVATE_KEY`
- `GENLAYER_RPC_URL`
- `NEXT_PUBLIC_ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers`
- `ONE_SHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers`
- `ALLOWED_GENLAYER_POLICY_ADDRESSES`
- `ALLOWED_EVM_CHAIN_IDS`

It does not store requests or transaction history. It validates approved
GenLayer payloads before forwarding them to the hosted 1Shot relayer.
