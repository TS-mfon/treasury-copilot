"use client";

import { useState } from "react";
import { RefreshCcw, Wallet } from "lucide-react";
import { Shell } from "@/components/Shell";
import { getRequest, listRequests, readPolicy } from "@/lib/genlayer";

export default function DashboardPage() {
  const [policy, setPolicy] = useState(process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "");
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [requests, setRequests] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [policyState, requestIds] = await Promise.all([
        readPolicy(policy),
        listRequests(policy),
      ]);
      const rows = await Promise.all(requestIds.map((id) => getRequest(policy, id)));
      setState(policyState);
      setRequests(rows.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setLoading(false);
    }
  }

  const metrics: Array<[string, string]> = [
    ["Delegated account", String(state?.delegated_account ?? "-")],
    ["Weekly spent", state?.weekly_spent_atto ? `${Number(state.weekly_spent_atto) / 1e6} USDC` : "-"],
    ["Authorized agent", String(state?.authorized_agent ?? "-")],
    ["Token", String(state?.token_address ?? "-")],
  ];

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Live dashboard</h1>
          <p className="mt-2 text-slate-600">Reads GenLayer policy and request state directly. No local request storage.</p>
        </div>
        <Wallet className="text-teal-700" />
      </div>

      <section className="panel rounded-lg p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <input className="field" value={policy} onChange={(event) => setPolicy(event.target.value)} placeholder="GenLayer policy address" />
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!policy || loading} onClick={refresh}>
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={String(label)} className="panel rounded-lg p-5">
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-2 break-all text-2xl font-semibold text-ink">{String(value)}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">Policy</h2>
          <pre className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-4 text-xs text-slate-100">
            {state ? JSON.stringify(state, null, 2) : "Enter a policy address and refresh."}
          </pre>
        </div>
        <div className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">Requests</h2>
          <div className="mt-4 space-y-3">
            {requests.length === 0 && <p className="text-sm text-slate-600">No live requests loaded.</p>}
            {requests.map((request) => (
              <article key={request.request_id} className="rounded-lg border border-slate-900/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="break-all text-sm font-semibold">{request.request_id}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${request.verdict === "approved" ? "bg-teal-50 text-teal-800" : "bg-red-50 text-red-800"}`}>
                    {request.verdict}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <div><dt className="font-medium">Recipient</dt><dd className="break-all">{request.recipient}</dd></div>
                  <div><dt className="font-medium">Amount</dt><dd>{Number(request.amount_atto) / 1e6} USDC</dd></div>
                  <div><dt className="font-medium">Category</dt><dd>{request.category}</dd></div>
                  <div><dt className="font-medium">Tx hash</dt><dd className="break-all">{request.tx_hash || "not recorded"}</dd></div>
                </dl>
                <p className="mt-3 text-sm leading-6 text-slate-700">{request.reasoning}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

    </Shell>
  );
}
