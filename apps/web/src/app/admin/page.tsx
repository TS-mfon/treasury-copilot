"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, ExternalLink, RefreshCw, ShieldCheck, X, XCircle, type LucideIcon } from "lucide-react";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import { Shell } from "@/components/Shell";
import { statusLabel, statusToneClass } from "@/lib/statusLabels";

type Overview = {
  configured: boolean;
  requests: number;
  events: number;
  active_agents: number;
  active_owners: number;
  executed: number;
  approved: number;
  denied: number;
  pending: number;
  failed: number;
};
type PilotRequest = { request_id: string; agent: string; recipient: string; amount: string; token_symbol: string; verdict: string; execution_status: string; tx_hash: string; created_at: string; reconciliation_status: string };
type PilotEvent = { event_id: string; event_type: string; request_id?: string; status?: string; created_at: string };

const number = (value: number | undefined) => new Intl.NumberFormat().format(value ?? 0);
const date = (value?: string) => value ? new Date(value).toLocaleString() : "Not available";

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [requests, setRequests] = useState<PilotRequest[]>([]);
  const [events, setEvents] = useState<PilotEvent[]>([]);
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  // The stream was read-only, so a request could be seen but never examined.
  const [inspected, setInspected] = useState<PilotRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [overviewResponse, requestsResponse, eventsResponse, dependenciesResponse] = await Promise.all([
        fetch("/api/pilot/overview", { cache: "no-store" }),
        fetch("/api/pilot/requests?limit=12", { cache: "no-store" }),
        fetch("/api/pilot/events?limit=16", { cache: "no-store" }),
        fetch("/api/pilot/dependencies", { cache: "no-store" }),
      ]);
      const payload = await overviewResponse.json();
      if (!overviewResponse.ok) throw new Error(payload.message ?? payload.error ?? "Pilot operations access denied");
      setOverview(payload);
      setRequests((await requestsResponse.json()).requests ?? []);
      setEvents((await eventsResponse.json()).events ?? []);
      setDependencies((await dependenciesResponse.json()).checks ?? {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pilot operations");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const metrics: Array<{ label: string; value: number | undefined; Icon: LucideIcon }> = [
    { label: "Requests", value: overview?.requests, Icon: Activity },
    { label: "Executed", value: overview?.executed, Icon: CheckCircle2 },
    { label: "Denied", value: overview?.denied, Icon: XCircle },
    { label: "Failed", value: overview?.failed, Icon: AlertTriangle },
  ];

  return (
    <ProtectedOwnerPage>
      <Shell>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline pb-6">
          <div>
            <div className="badge text-purple"><Activity size={13} className="mr-1" /> PILOT OPERATIONS</div>
            <h1 className="mt-3 text-3xl font-semibold">Testnet control room</h1>
            <p className="mt-2 max-w-2xl text-neutral-400">Read only operational visibility for public testnet activity. GenLayer and Base remain authoritative.</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-md border border-outline px-3 py-2 text-sm font-semibold text-neutral-200 disabled:opacity-50" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error && <p className="mt-5 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <section className="mt-6 grid gap-px overflow-hidden border border-outline bg-outline sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(({ label, value, Icon }) => (
            <div className="bg-surface-low p-5" key={label}>
              <Icon size={16} className="text-purple" />
              <p className="mt-5 text-xs uppercase tracking-widest text-neutral-500">{label}</p>
              <p className="mt-1 text-3xl font-semibold">{number(value as number | undefined)}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="border border-outline bg-surface-low">
            <div className="flex items-center justify-between border-b border-outline p-4">
              <div><p className="eyebrow purple-text">REQUEST STREAM</p><h2 className="mt-1 text-lg font-semibold">Recent testnet requests</h2><p className="mt-1 text-xs text-neutral-500">Select a row to inspect it.</p></div>
              <span className="font-mono text-xs text-neutral-500">{number(overview?.active_agents)} agents</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="border-b border-outline text-neutral-500"><tr><th className="p-3">Request</th><th className="p-3">State</th><th className="p-3">Amount</th><th className="p-3">Observed</th></tr></thead>
                <tbody>
                  {requests.map((row) => <tr
                    className={`cursor-pointer border-b border-outline/70 transition-colors hover:bg-purple/10 ${inspected?.request_id === row.request_id ? "bg-purple/10" : ""}`}
                    key={row.request_id}
                    tabIndex={0}
                    onClick={() => setInspected(row)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setInspected(row); } }}
                  >
                    <td className="p-3"><span className="block font-mono text-neutral-200">{row.request_id.slice(0, 14)}...</span><span className="mt-1 block text-neutral-500">{row.agent.slice(0, 12)}...</span></td>
                    <td className="p-3"><span className={row.verdict === "denied" ? "text-danger" : statusToneClass(row.execution_status)}>{row.verdict === "denied" ? "Denied" : statusLabel(row.execution_status)}</span><span className="mt-1 block text-neutral-500">{row.reconciliation_status}</span></td>
                    <td className="p-3 font-mono">{row.amount} {row.token_symbol}</td>
                    <td className="p-3 text-neutral-500">{date(row.created_at)}</td>
                  </tr>)}
                  {requests.length === 0 && <tr><td className="p-6 text-neutral-500" colSpan={4}>No persisted pilot requests yet. MongoDB persistence activates after `MONGODB_URI` is configured.</td></tr>}
                </tbody>
              </table>
            </div>
            {inspected && (
              <div className="mt-5 rounded-md border border-purple/40 bg-purple/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow purple-text">INSPECTING</p>
                    <p className="mt-1 break-all font-mono text-xs text-neutral-200">{inspected.request_id}</p>
                  </div>
                  <button
                    className="rounded-md border border-outline p-1.5 text-neutral-400 hover:text-ink"
                    onClick={() => setInspected(null)}
                    aria-label="Close inspector"
                  >
                    <X size={14} />
                  </button>
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {([
                    ["Outcome", inspected.verdict === "denied" ? "Denied" : statusLabel(inspected.execution_status)],
                    ["Verdict", statusLabel(inspected.verdict)],
                    ["Amount", `${inspected.amount} ${inspected.token_symbol}`],
                    ["Agent", inspected.agent],
                    ["Recipient", inspected.recipient],
                    ["Reconciliation", inspected.reconciliation_status || "Not recorded"],
                    ["Observed", date(inspected.created_at)],
                  ] as Array<[string, string]>).map(([term, value]) => (
                    <div key={term}>
                      <dt className="text-[11px] uppercase text-neutral-500">{term}</dt>
                      <dd className="mt-1 break-all font-mono text-xs text-neutral-200">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 border-t border-outline pt-4">
                  <p className="text-[11px] uppercase text-neutral-500">Settlement transaction</p>
                  {inspected.tx_hash
                    ? <p className="mt-1 break-all font-mono text-xs text-neutral-200">{inspected.tx_hash}</p>
                    : <p className="mt-1 text-xs text-neutral-500">
                        No transaction. {inspected.verdict === "denied"
                          ? "The request was denied, so nothing was ever sent on chain."
                          : "Not settled yet."}
                      </p>}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="inline-flex items-center gap-2 rounded-md border border-outline px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-ink"
                    onClick={() => void navigator.clipboard?.writeText(inspected.request_id)}
                  >
                    Copy request id
                  </button>
                  {events.some((event) => event.request_id === inspected.request_id) && (
                    <span className="inline-flex items-center gap-2 text-xs text-neutral-400">
                      <ExternalLink size={12} />
                      {events.filter((event) => event.request_id === inspected.request_id).length} lifecycle event(s) below
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border border-outline bg-surface-low">
            <div className="border-b border-outline p-4"><p className="eyebrow green-text">DEPENDENCIES</p><h2 className="mt-1 text-lg font-semibold">Pilot readiness</h2></div>
            <div className="divide-y divide-outline">
              {Object.entries(dependencies).map(([name, status]) => <div className="flex items-center justify-between p-4 text-sm" key={name}><span className="flex items-center gap-2 text-neutral-300"><ShieldCheck size={15} className="text-purple" /> {name}</span><span className={status === "missing" ? "text-danger" : "text-success"}>{status}</span></div>)}
              {Object.keys(dependencies).length === 0 && <p className="p-5 text-sm text-neutral-500">Dependency status unavailable.</p>}
            </div>
            <div className="border-t border-outline p-4 text-xs text-neutral-500">{number(overview?.active_owners)} active owners · {number(overview?.events)} lifecycle events</div>
          </div>
        </section>

        <section className="mt-6 border border-outline bg-surface-low">
          <div className="border-b border-outline p-4"><p className="eyebrow amber-text">AUDIT STREAM</p><h2 className="mt-1 text-lg font-semibold">Latest lifecycle events</h2></div>
          <div className="grid gap-px bg-outline sm:grid-cols-2 lg:grid-cols-4">
            {events.map((event) => <div className="bg-surface-low p-4" key={event.event_id}><Clock3 size={14} className="text-amber" /><p className="mt-3 text-xs font-semibold text-neutral-200">{event.event_type}</p><p className="mt-1 font-mono text-[10px] text-neutral-500">{event.request_id?.slice(0, 14) ?? "system"}</p><p className="mt-3 text-[10px] text-neutral-600">{date(event.created_at)}</p></div>)}
            {events.length === 0 && <p className="bg-surface-low p-6 text-sm text-neutral-500 sm:col-span-2 lg:col-span-4">No lifecycle events have been persisted yet.</p>}
          </div>
        </section>
      </Shell>
    </ProtectedOwnerPage>
  );
}
