import { chainById, type ExecutionBackend } from "@treasury-copilot/shared";

/**
 * Which settlement mechanism a chain uses.
 *
 * This is the single decision point that keeps Arc out of the ERC-7715 / 1Shot path. That path
 * needs the MetaMask Delegation Framework deployed on-chain and a 1Shot capability entry, and
 * Arc has neither, so routing a request there would fail deep inside the relayer with a
 * confusing error instead of at the boundary.
 */
export function settlementBackendForChainId(chainId: number): ExecutionBackend {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  return chain.executionBackend;
}

export function isVaultSettledChain(chainId: number): boolean {
  return settlementBackendForChainId(chainId) === "arc-vault";
}

/** True when the chain settles by redelegating an owner's ERC-7715 permission to 1Shot. */
export function isDelegationSettledChain(chainId: number): boolean {
  return settlementBackendForChainId(chainId) === "delegated-7710";
}

/**
 * Whether Arc settlement is switched on for this deployment.
 *
 * Kept as a server-side flag so an Arc binding cannot start executing just because the chain
 * config exists, matching how Base Mainnet stayed gated in docs/deployment.md.
 */
export function arcSettlementEnabled(): boolean {
  const raw = process.env.ARC_SETTLEMENT_ENABLED;
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function assertSettlementAvailable(chainId: number) {
  if (isVaultSettledChain(chainId) && !arcSettlementEnabled()) {
    throw new Error("Arc settlement is disabled for this deployment");
  }
}
