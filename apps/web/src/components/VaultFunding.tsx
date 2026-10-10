"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, LoaderCircle, Wallet } from "lucide-react";
import { parseUnits, type Address } from "viem";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";
import { fundVaultWithUsdc, readVaultBalance } from "@/lib/evm";
import { friendlyError } from "@/lib/errors";
import { useEnsureChain } from "@/lib/useEnsureChain";

/**
 * Move USDC from the owner's wallet into an agent treasury vault.
 *
 * Used both at the end of setup and from the top-up page, because they are the same action: a vault
 * that has just been deployed is empty, and a vault that has been paying is eventually empty again.
 */
export function VaultFunding({
  chainKey,
  vault,
  label,
  onFunded,
  onBalance,
  highlight = false,
}: {
  chainKey: SupportedChainKey;
  vault: Address;
  label?: string;
  onFunded?: (hash: string) => void;
  /** Reports the vault balance upward so the caller can tell funded from empty. */
  onBalance?: (formatted: string | null) => void;
  /**
   * Draw the owner's attention here: scroll into view, focus the amount field, and pulse the
   * border. Setup raises this once the API key exists, because that is the moment the owner
   * thinks they are finished — and an unfunded vault means the agent's first request is refused.
   */
  highlight?: boolean;
}) {
  const chain = SUPPORTED_CHAINS[chainKey];
  const decimals = chain.tokens.USDC?.decimals ?? 6;
  const ensureChain = useEnsureChain();

  const [amount, setAmount] = useState("10");
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { formatted } = await readVaultBalance(chainKey, vault);
      setBalance(formatted);
      onBalance?.(formatted);
    } catch {
      // A read failure must not look like an empty vault, which would be a misleading zero.
      setBalance(null);
      onBalance?.(null);
    }
  }, [chainKey, vault, onBalance]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Read through a ref so that starting a transaction does not re-run the effect below and yank
  // focus out of the wallet confirmation.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Only pull focus for a vault that is actually empty. Nagging someone who already funded it
  // trains them to ignore the thing, and stealing focus mid-typing is its own bug.
  useEffect(() => {
    if (!highlight || balance !== "0" || busyRef.current) return;
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTimer = setTimeout(() => {
      amountRef.current?.focus();
      amountRef.current?.select();
    }, 350);
    setFlash(true);
    const flashTimer = setTimeout(() => setFlash(false), 2_600);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(flashTimer);
    };
  }, [highlight, balance]);

  async function fund() {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const units = parseUnits(amount.trim() || "0", decimals);
      await ensureChain(chain.chainId);
      setStatus(`Sending ${amount} USDC to the vault on ${chain.name}...`);
      const { hash } = await fundVaultWithUsdc(chainKey, vault, units);
      setStatus(`Funded. Transaction ${hash}`);
      await refresh();
      onFunded?.(hash);
    } catch (err) {
      setError(friendlyError(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const empty = balance === "0";

  return (
    <div
      ref={containerRef}
      className={`rounded-md border bg-neutral-900/40 p-4 transition-shadow ${
        flash
          ? "animate-pulse border-warning shadow-[0_0_0_3px_rgba(245,158,11,0.35)]"
          : "border-outline"
      }`}
    >
      <div className="flex items-center gap-2">
        <Coins size={16} className="text-purple" />
        <h3 className="text-sm font-semibold">{label ? `Fund ${label}` : "Fund this vault"}</h3>
      </div>
      <p className="mt-2 break-all font-mono text-xs text-neutral-400">{vault}</p>
      <p className="mt-2 text-xs text-neutral-400">
        {chain.name} &middot; in vault:{" "}
        <span className={empty ? "font-semibold text-warning" : "font-semibold text-ink"}>
          {balance === null ? "unknown" : `${balance} USDC`}
        </span>
      </p>
      {empty && (
        <p className="mt-2 text-xs text-warning">
          An empty vault refuses every payment. Your agent will receive a{" "}
          <span className="font-mono">402 vault_unfunded</span> until this holds USDC.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold uppercase text-neutral-500">
          Amount in USDC
          <input
            ref={amountRef}
            className="field w-32"
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="10"
          />
        </label>
        <button
          className="inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
          disabled={busy || !amount.trim()}
          onClick={() => void fund()}
        >
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Wallet size={15} />}
          {busy ? "Confirm in your wallet..." : "Fund vault"}
        </button>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        This sends USDC from your own wallet to the vault you own. You keep withdraw and pause
        authority; the executor can only pay out requests the policy has already approved.
      </p>

      {status && <p className="mt-3 break-all text-xs text-success">{status}</p>}
      {error && (
        <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
