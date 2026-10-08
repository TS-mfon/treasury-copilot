import { chainById, type ChainConfig, type ExecutionBackend } from "@treasury-copilot/shared";

/**
 * Which settlement mechanism a chain uses.
 *
 * This is the single decision point that keeps Arc out of the ERC-7715 / 1Shot path. That path
 * needs the MetaMask Delegation Framework deployed on-chain and a 1Shot capability entry, and
 * Arc has neither, so routing a request there would fail deep inside the relayer with a
 * confusing error instead of at the boundary.
 */
export function settlementBackendForChainId(chainId: number): ExecutionBackend {
  const chain = requireChain(chainId);
  // A payout destination has no treasury, so binding a policy to one would produce a policy that
  // can never execute. Fail here rather than at execution time.
  if (chain.destinationOnly) {
    throw new Error(`${chain.name} is a payout destination only and cannot hold a treasury`);
  }
  return chain.executionBackend;
}

function requireChain(chainId: number): ChainConfig {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  return chain;
}

/** Whether a chain can be the settlement chain for a policy. */
export function canSettleOnChain(chainId: number): boolean {
  const chain = chainById(chainId);
  return Boolean(chain && !chain.destinationOnly);
}

/** Whether an approved payment can be delivered to this chain over CCTP. */
export function canReceiveCctp(chainId: number): boolean {
  return Boolean(chainById(chainId)?.cctp);
}

/** CCTP domain for a chain, or undefined when CCTP does not support it. */
export function cctpDomainFor(chainId: number): number | undefined {
  return chainById(chainId)?.cctp?.domain;
}

export function isVaultSettledChain(chainId: number): boolean {
  return canSettleOnChain(chainId) && settlementBackendForChainId(chainId) === "arc-vault";
}

/** True when the chain settles by redelegating an owner's ERC-7715 permission to 1Shot. */
export function isDelegationSettledChain(chainId: number): boolean {
  return canSettleOnChain(chainId) && settlementBackendForChainId(chainId) === "delegated-7710";
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
