"use client";

import { useCallback, useEffect, useState } from "react";
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
}: {
  chainKey: SupportedChainKey;
  vault: Address;
  label?: string;
  onFunded?: (hash: string) => void;
}) {
  const chain = SUPPORTED_CHAINS[chainKey];
  const decimals = chain.tokens.USDC?.decimals ?? 6;
  const ensureChain = useEnsureChain();

  const [amount, setAmount] = useState("10");
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    try {
      setBalance((await readVaultBalance(chainKey, vault)).formatted);
    } catch {
      // A read failure must not look like an empty vault, which would be a misleading zero.
      setBalance(null);
    }
  }, [chainKey, vault]);

  useEffect(() => { void refresh(); }, [refresh]);

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
    <div className="rounded-md border border-outline bg-neutral-900/40 p-4">
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
