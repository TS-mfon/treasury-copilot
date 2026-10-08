"use client";

import { useCallback } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { chainById } from "@treasury-copilot/shared";

/**
 * Put the wallet on the chain an action belongs to, before signing.
 *
 * Owner actions are signed over an EIP-712 domain bound to the policy's own chain. Wallets refuse
 * to sign a domain whose chainId differs from the active network ("Provided chainId X must match
 * the active chainId Y"), so every signature site must switch first rather than ask the user to do
 * it manually and retry.
 *
 * The connector adds an unknown network itself when it can, which is how Arc appears in a wallet
 * that has never seen it.
 */
export function useEnsureChain() {
  const { chainId: activeChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  return useCallback(
    async (targetChainId: number) => {
      if (!isConnected) throw new Error("Connect your wallet first");
      if (!Number.isInteger(targetChainId) || targetChainId <= 0) {
        throw new Error("This action has no chain to sign on");
      }
      if (activeChainId === targetChainId) return;

      const target = chainById(targetChainId);
      const name = target?.name ?? `chain ${targetChainId}`;
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A rejected switch is a user decision, not a failure to explain away.
        if (/user rejected|denied|4001/i.test(message)) {
          throw new Error(`Switch your wallet to ${name} to sign this action`);
        }
        throw new Error(`Could not switch your wallet to ${name}: ${message}`);
      }
    },
    [activeChainId, isConnected, switchChainAsync],
  );
}
