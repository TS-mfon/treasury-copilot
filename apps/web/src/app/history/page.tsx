"use client";

import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Shell } from "@/components/Shell";
import { friendlyError } from "@/lib/errors";

interface HistoryRow {
  request_id: string;
  recipient: string;
  amount: string;
  category: string;
  verdict: string;
  reasoning: string;
  tx_hash: string;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/owner/history?limit=50");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "History failed");
      setRows(data.requests ?? []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="badge text-purple">ON-CHAIN AUDIT</div>
            <h1 className="mt-3 text-3xl font-semibold">Request history</h1>
            <p className="mt-2 max-w-3xl text-neutral-400">Loaded from GenLayer request records with execution tx hashes recorded after 1Shot completion.</p>
          </div>
          <History className="text-purple" />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={loading} onClick={load}>
            <RefreshCw size={16} /> {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="border-b border-outline text-xs uppercase text-neutral-500">
              <tr>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Amount</th>
                <th className="py-3 pr-4">Recipient</th>
                <th className="py-3 pr-4">Reason</th>
                <th className="py-3 pr-4">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.request_id} className="border-b border-outline align-top">
                  <td className="py-4 pr-4"><span className={`badge ${row.verdict === "approved" ? "text-success" : "text-danger"}`}>{row.verdict}</span></td>
                  <td className="py-4 pr-4 font-mono">{row.amount}</td>
                  <td className="py-4 pr-4 font-mono text-xs text-neutral-300">{row.recipient}</td>
                  <td className="max-w-md py-4 pr-4 text-neutral-400">{row.reasoning}</td>
                  <td className="py-4 pr-4 font-mono text-xs text-purple">{row.tx_hash || "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="py-8 text-neutral-500" colSpan={5}>No history loaded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
