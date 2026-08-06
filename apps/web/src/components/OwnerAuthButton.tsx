"use client";

import { useState } from "react";
import { LogIn, LogOut, Wallet } from "lucide-react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { useOwnerSession } from "@/components/OwnerSessionProvider";

export function OwnerAuthButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { authenticated, refreshSession } = useOwnerSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      const challengeResponse = await fetch("/api/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: address }) });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error ?? "Could not start wallet login");
      const signature = await signMessageAsync({ message: challenge.message });
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: address, nonce: challenge.nonce, message: challenge.message, signature }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not authenticate wallet");
      await refreshSession();
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await refreshSession();
    window.location.assign("/");
  }

  if (!isConnected) {
    const connector = connectors[0];
    return <button title={error || undefined} className="inline-flex items-center gap-2 rounded-md border border-outline px-3 py-2 text-sm text-neutral-200" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}><Wallet size={16} /> Connect wallet</button>;
  }
  if (authenticated) return <button className="inline-flex items-center gap-2 rounded-md border border-outline px-3 py-2 text-sm text-neutral-200" onClick={logout}><LogOut size={16} /> Log out</button>;
  return <button className="inline-flex items-center gap-2 rounded-md bg-purple px-3 py-2 text-sm font-semibold text-black disabled:opacity-50" disabled={busy} onClick={login}><LogIn size={16} /> {busy ? "Signing in…" : "Unlock"}</button>;
}
