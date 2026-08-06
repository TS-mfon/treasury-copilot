"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { shouldBlockSetupNavigation } from "@/lib/ownerAccess";

type OwnerSessionValue = {
  authenticated: boolean;
  loading: boolean;
  owner: string | null;
  setupBlocked: boolean;
  unlockNoticeVisible: boolean;
  dismissUnlockNotice: () => void;
  refreshSession: () => Promise<void>;
  showUnlockNotice: () => void;
};

const OwnerSessionContext = createContext<OwnerSessionValue | null>(null);

export function OwnerSessionProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlockNoticeVisible, setUnlockNoticeVisible] = useState(false);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const result = response.ok
        ? await response.json() as { authenticated?: boolean; owner?: string | null }
        : { authenticated: false, owner: null };
      setSessionAuthenticated(Boolean(result.authenticated));
      setOwner(result.owner ?? null);
    } catch {
      setSessionAuthenticated(false);
      setOwner(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const setupBlocked = shouldBlockSetupNavigation({
    walletConnected: isConnected,
    sessionAuthenticated,
    sessionOwner: owner,
    walletAddress: address,
  });
  const authenticated = sessionAuthenticated && (!isConnected || !address || owner?.toLowerCase() === address.toLowerCase());

  useEffect(() => {
    if (authenticated) setUnlockNoticeVisible(false);
  }, [authenticated]);

  const value = useMemo<OwnerSessionValue>(() => ({
    authenticated,
    loading,
    owner,
    setupBlocked,
    unlockNoticeVisible,
    dismissUnlockNotice: () => setUnlockNoticeVisible(false),
    refreshSession,
    showUnlockNotice: () => setUnlockNoticeVisible(true),
  }), [authenticated, loading, owner, refreshSession, setupBlocked, unlockNoticeVisible]);

  return <OwnerSessionContext.Provider value={value}>{children}</OwnerSessionContext.Provider>;
}

export function useOwnerSession() {
  const value = useContext(OwnerSessionContext);
  if (!value) throw new Error("useOwnerSession must be used inside OwnerSessionProvider");
  return value;
}
