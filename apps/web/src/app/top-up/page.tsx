"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, LoaderCircle } from "lucide-react";
import { isAddress, type Address } from "viem";
import { chainById, type SupportedChainKey } from "@treasury-copilot/shared";
import { Shell } from "@/components/Shell";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import { VaultFunding } from "@/components/VaultFunding";
import { friendlyError } from "@/lib/errors";

type PolicyRow = {
  policy: Address;
  label: string | null;
  binding: { chain_id: string; agent: string; delegated_account: string };
  state: { settlement_backend?: string; vault_address?: string; vault_registered?: boolean };
};

/** The vault to fund, and the chain it lives on, or null when this policy has no vault. */
function vaultOf(row: PolicyRow): { vault: Address; chainKey: SupportedChainKey } | null {
  if ((row.state.settlement_backend ?? "delegated-7710") !== "arc-vault") return null;
  // V6 stores the vault explicitly; earlier shapes keep it in the registry-pinned funding account.
  const candidate = row.state.vault_address && isAddress(row.state.vault_address)
    ? row.state.vault_address
    : row.binding.delegated_account;
  if (!candidate || !isAddress(candidate)) return null;
  const chain = chainById(Number(row.binding.chain_id));
  if (!chain) return null;
  return { vault: candidate as Address, chainKey: chain.key };
}

export default function TopUpPage() {
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/owner/policies", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not load your agents");
      const all = (data.policies ?? []) as PolicyRow[];
      setRows(all);
      const fundable = all.filter((row) => vaultOf(row));
      setSelected((current) => current || fundable[0]?.policy || "");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fundable = useMemo(() => rows.filter((row) => vaultOf(row)), [rows]);
  const active = fundable.find((row) => row.policy === selected);
  const target = active ? vaultOf(active) : null;

  return (
    <ProtectedOwnerPage>
      <Shell>
        <header>
          <div className="flex items-center gap-2">
            <Coins size={18} className="text-purple" />
            <h1 className="text-2xl font-semibold">Top up</h1>
          </div>
          <p className="mt-2 max-w-prose text-neutral-400">
            A vault-settled agent pays out of a contract you own, and that contract starts empty.
            Deploying it is not the same as funding it. Send USDC here whenever a vault runs low.
          </p>
        </header>

        {loading && (
          <p className="mt-6 flex items-center gap-2 text-sm text-neutral-400">
            <LoaderCircle size={15} className="animate-spin" /> Loading your agents...
          </p>
        )}

        {error && (
          <p className="mt-6 rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">{error}</p>
        )}

        {!loading && !error && fundable.length === 0 && (
          <div className="panel mt-6 rounded-lg p-6">
            <p className="text-sm text-neutral-300">No vault-settled agents yet.</p>
            <p className="mt-2 text-sm text-neutral-400">
              {rows.length > 0
                ? "Your agents settle through a wallet permission, so their USDC stays in your own account and there is no vault to fund."
                : "Register an agent on a vault-settled chain first."}
            </p>
          </div>
        )}

        {!loading && fundable.length > 0 && (
          <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1fr]">
            <div className="panel rounded-lg p-5">
              <h2 className="text-sm font-semibold">Choose an agent</h2>
              <div className="mt-4 grid gap-2">
                {fundable.map((row) => {
                  const info = vaultOf(row);
                  const chain = chainById(Number(row.binding.chain_id));
                  const isActive = row.policy === selected;
                  return (
                    <button
                      key={row.policy}
                      onClick={() => setSelected(row.policy)}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        isActive
                          ? "border-purple bg-purple/10"
                          : "border-outline bg-neutral-900/40 hover:border-neutral-600"
                      }`}
                    >
                      <p className="text-sm font-semibold">
                        {row.label ?? `Agent ${row.binding.agent.slice(0, 10)}`}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">{chain?.name ?? row.binding.chain_id}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">
                        {info?.vault}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              {active && target ? (
                <VaultFunding
                  chainKey={target.chainKey}
                  vault={target.vault}
                  label={active.label ?? undefined}
                  onFunded={() => void load()}
                />
              ) : (
                <p className="text-sm text-neutral-400">Select an agent to fund.</p>
              )}
            </div>
          </section>
        )}
      </Shell>
    </ProtectedOwnerPage>
  );
}
