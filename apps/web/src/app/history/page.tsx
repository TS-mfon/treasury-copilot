"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Shell } from "@/components/Shell";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import { friendlyError } from "@/lib/errors";

interface HistoryRow {
  request_id: string;
  agent: string;
  recipient: string;
  amount: string;
  token_symbol: string;
  category: string;
  status: string;
  verdict: string;
  reasoning: string;
  execution_error: string;
  tx_hash: string;
  explorer_url?: string | null;
  created_at: string;
  updated_at: string;
}

function statusClass(row: HistoryRow) {
  if (row.status === "executed") return "text-success";
  if (row.verdict === "denied" || row.status === "failed") return "text-danger";
  if (row.status === "executing" || row.status === "approved") return "text-signal";
  return "text-neutral-300";
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value || "-" : date.toLocaleString();
}

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/owner/history?limit=100");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "History failed");
      setRows(data.requests ?? []);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProtectedOwnerPage>
      <Shell>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline pb-6">
          <div>
            <div className="badge text-purple">ON-CHAIN AUDIT</div>
            <h1 className="mt-3 text-3xl font-semibold">Request history</h1>
            <p className="mt-2 max-w-3xl text-neutral-400">GenLayer verdicts, execution lifecycle, failures, and confirmed EVM transaction hashes.</p>
          </div>
          <button className="icon-button" title="Refresh history" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {error && <p className="mt-5 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 overflow-x-auto border border-outline">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="border-b border-outline bg-surface-low text-[11px] uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.request_id} className="border-b border-outline bg-paper align-top last:border-b-0 hover:bg-surface-low">
                  <td className="px-4 py-4"><span className={`badge ${statusClass(row)}`}>{row.status.replaceAll("_", " ")}</span></td>
                  <td className="px-4 py-4 font-mono">{row.amount} {row.token_symbol}</td>
                  <td className="max-w-48 px-4 py-4 break-all font-mono text-xs text-neutral-300">{row.recipient}</td>
                  <td className="max-w-md px-4 py-4">
                    <p className="text-neutral-300">{row.reasoning}</p>
                    {row.execution_error && <p className="mt-2 text-xs text-danger">{row.execution_error}</p>}
                    <p className="mt-2 font-mono text-[10px] text-neutral-600">{row.request_id}</p>
                  </td>
                  <td className="px-4 py-4 text-xs text-neutral-400">{displayTime(row.updated_at || row.created_at)}</td>
                  <td className="px-4 py-4">
                    {row.explorer_url ? (
                      <a href={row.explorer_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-purple">
                        {row.tx_hash.slice(0, 10)}... <ExternalLink size={12} />
                      </a>
                    ) : <span className="text-neutral-600">Pending</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td className="px-4 py-10 text-neutral-500" colSpan={6}>No on-chain requests found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Shell>
    </ProtectedOwnerPage>
  );
}
