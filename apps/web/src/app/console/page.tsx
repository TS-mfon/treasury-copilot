"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Clipboard, Code2, ExternalLink, KeyRound, LoaderCircle, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { Shell } from "@/components/Shell";

type RequestRecord = {
  request_id: string;
  status?: string;
  execution_status?: string;
  verdict?: string;
  reasoning?: string;
  execution_error?: string;
  explorer_url?: string | null;
  amount?: string;
  token_symbol?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
};
type Health = { status: string; environment: string; checked_at: string; checks: Record<string, string> };
const lifecycle = ["submitted", "reviewing", "approved", "executing", "executed"];
const label = (value: string) => value.replaceAll("_", " ");
const tone = (value: string) => value === "executed" || value === "approved" ? "text-success" : value === "denied" || value === "failed" ? "text-danger" : "text-signal";
const when = (value?: string) => { if (!value) return "Not available"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); };

export default function ConsolePage() {
  const [key, setKey] = useState("");
  const [agent, setAgent] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [category, setCategory] = useState("api_subscription");
  const [justification, setJustification] = useState("Testnet API invoice for pilot validation");
  const [idempotencyKey, setIdempotencyKey] = useState(`pilot_${Date.now()}`);
  const [requestId, setRequestId] = useState("");
  const [record, setRecord] = useState<RequestRecord | null>(null);
  const [history, setHistory] = useState<RequestRecord[]>([]);
  const [balance, setBalance] = useState<Record<string, unknown> | null>(null);
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${key.trim()}`, Accept: "application/json", "Content-Type": "application/json" }), [key]);
  const callAgent = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!key.trim()) throw new Error("Paste an agent API key to use the console");
    const response = await fetch(`/api/v1${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message ?? data.error ?? `Request failed with status ${response.status}`);
    return data;
  }, [headers, key]);
  const loadHealth = useCallback(async () => { const response = await fetch("/api/health", { cache: "no-store" }); setHealth(await response.json()); }, []);
  const loadOverview = useCallback(async () => {
    setError(""); setBusy("Loading");
    try {
      const [balanceData, policyData, historyData] = await Promise.all([callAgent("/balance"), callAgent("/policy"), callAgent("/history?limit=25")]);
      setBalance(balanceData); setPolicy(policyData.state ?? policyData); setHistory(historyData.requests ?? []); setNotice("Live testnet state loaded from the agent API");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load agent state"); } finally { setBusy(""); }
  }, [callAgent]);
  useEffect(() => { void loadHealth(); }, [loadHealth]);
  async function submitSpend() {
    setError(""); setNotice(""); setBusy("Submitting");
    try {
      const data = await callAgent("/spend", { method: "POST", body: JSON.stringify({ agent_address: agent, recipient, amount, category, justification, idempotency_key: idempotencyKey }) });
      setRequestId(data.request_id); setRecord(data.request ?? null); setNotice(data.idempotent_replay ? "Existing request returned safely from idempotency lookup" : "Request accepted by the policy pipeline"); await loadOverview();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit request"); } finally { setBusy(""); }
  }
  async function pollRequest() {
    if (!requestId.trim()) { setError("Enter a request ID before polling"); return; }
    setError(""); setBusy("Polling");
    try { const data = await callAgent(`/requests/${requestId.trim()}`); setRecord(data.request ?? null); setNotice("Request state refreshed from GenLayer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not poll request"); } finally { setBusy(""); }
  }
  const currentStatus = record?.execution_status ?? record?.status ?? "submitted";
  const denied = currentStatus === "denied" || record?.verdict === "denied";
  const activeIndex = lifecycle.indexOf(currentStatus);
  return <Shell>
    <div className="border-b border-outline pb-6"><div className="badge text-purple"><Code2 size={13} className="mr-1" /> AGENT API CONSOLE</div><div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold text-ink">Testnet control room</h1><p className="mt-2 max-w-3xl text-neutral-400">Inspect the live agent binding, submit a bounded test request, and follow its decision to Base Sepolia settlement.</p></div><div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"><Activity size={15} /> TESTNET ONLY</div></div></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="panel rounded-lg p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Developer access</h2><KeyRound size={18} className="text-purple" /></div><p className="mt-2 text-sm text-neutral-400">This key stays in this tab memory and is cleared when you refresh. Never paste a production credential here.</p><label className="mt-5 block text-xs font-semibold uppercase text-neutral-500">Agent API key<input className="mt-2 w-full rounded-md border border-outline bg-black px-3 py-3 font-mono text-xs text-ink outline-none focus:border-purple" type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="tcp_..." autoComplete="off" /></label><div className="mt-4 flex gap-2"><button className="inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={!key.trim() || Boolean(busy)} onClick={() => void loadOverview()}><RefreshCw size={15} className={busy === "Loading" ? "animate-spin" : ""} /> Load live state</button><button className="icon-button" title="Refresh service health" onClick={() => void loadHealth()}><Activity size={16} /></button></div>{health && <div className="mt-5 border-t border-outline pt-4"><div className={`text-sm font-semibold ${health.status === "healthy" ? "text-success" : "text-warning"}`}>{health.status.toUpperCase()} <span className="font-normal text-neutral-500">{health.environment}</span></div><div className="mt-3 grid gap-2 text-xs">{Object.entries(health.checks).map(([name, value]) => <div key={name} className="flex justify-between border-b border-outline pb-2 text-neutral-400"><span>{label(name)}</span><span className={value === "missing" ? "text-danger" : "text-success"}>{value}</span></div>)}</div></div>}</section>
      <section className="panel rounded-lg p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Live state</h2><button className="icon-button" title="Refresh live state" disabled={!key.trim() || Boolean(busy)} onClick={() => void loadOverview()}><RefreshCw size={16} className={busy === "Loading" ? "animate-spin" : ""} /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Balance" value={balance ? `${String(balance.balance ?? "0")} ${String(balance.token_symbol ?? "USDC")}` : "Not loaded"} /><Metric label="Weekly available" value={balance ? `${String(balance.weekly_available ?? "0")} ${String(balance.token_symbol ?? "USDC")}` : "Not loaded"} /><Metric label="Policy version" value={policy ? String(policy.contract_version ?? "Unknown") : "Not loaded"} /></div>{policy && <div className="mt-4 rounded-md border border-outline bg-black p-3 text-xs text-neutral-400"><div className="flex items-center gap-2 text-success"><ShieldCheck size={14} /> Policy binding verified by API</div><div className="mt-2 font-mono text-[11px]">Per request cap: {String(policy.per_tx_cap ?? "not returned")} | Weekly cap: {String(policy.weekly_cap ?? "not returned")}</div></div>}</section>
    </div>
    {(error || notice) && <div className={`mt-6 rounded-md border p-3 text-sm ${error ? "border-danger/40 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success"}`}>{error || notice}</div>}
    <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr]"><div className="panel rounded-lg p-5"><div className="flex items-center gap-2"><Send size={17} className="text-purple" /><h2 className="text-lg font-semibold">Submit test request</h2></div><p className="mt-2 text-sm text-neutral-400">Use a small amount and a recipient that belongs to your testnet workflow.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Registered agent address" value={agent} onChange={setAgent} placeholder="0x..." /><Field label="Recipient address" value={recipient} onChange={setRecipient} placeholder="0x..." /><Field label="Amount in USDC" value={amount} onChange={setAmount} placeholder="0.01" /><Field label="Category" value={category} onChange={setCategory} placeholder="api_subscription" /><Field label="Idempotency key" value={idempotencyKey} onChange={setIdempotencyKey} placeholder="pilot_invoice_001" /><label className="text-xs font-semibold uppercase text-neutral-500 sm:col-span-2">Justification<textarea className="mt-2 min-h-24 w-full rounded-md border border-outline bg-black px-3 py-2 text-sm font-normal normal-case text-ink outline-none focus:border-purple" value={justification} onChange={(event) => setJustification(event.target.value)} /></label></div><button className="mt-5 inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={!key.trim() || Boolean(busy)} onClick={() => void submitSpend()}>{busy === "Submitting" ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />} Submit request</button></div>
      <div className="panel rounded-lg p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Request lifecycle</h2>{record && <span className={`badge ${tone(currentStatus)}`}>{label(currentStatus)}</span>}</div>{record ? <><div className="mt-5 grid gap-3">{lifecycle.map((stage, index) => <div key={stage} className={`flex items-center gap-3 rounded-md border p-3 ${stage === currentStatus ? "border-purple bg-purple/10" : "border-outline"}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${index <= activeIndex && !denied ? "bg-success text-black" : "bg-surface-high text-neutral-500"}`}>{index <= activeIndex && !denied ? <CheckCircle2 size={15} /> : index + 1}</span><span className="capitalize text-sm">{stage}</span></div>)}{denied && <div className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><XCircle size={17} className="mt-0.5 shrink-0" /><span><strong>Denied</strong><br />{record.reasoning || record.execution_error || "The request did not satisfy policy."}</span></div>}</div><div className="mt-5 border-t border-outline pt-4 text-xs text-neutral-400"><div className="flex justify-between gap-4"><span>Request ID</span><button className="inline-flex max-w-[70%] items-center gap-1 truncate font-mono text-purple" title="Copy request ID" onClick={() => void navigator.clipboard?.writeText(record.request_id)}>{record.request_id}<Clipboard size={12} /></button></div><div className="mt-2 flex justify-between gap-4"><span>Created</span><span>{when(record.created_at)}</span></div>{record.explorer_url && <a className="mt-3 inline-flex items-center gap-1 text-purple" href={record.explorer_url} target="_blank" rel="noreferrer">Open settlement receipt <ExternalLink size={12} /></a>}</div></> : <div className="mt-8 rounded-md border border-dashed border-outline p-8 text-center text-sm text-neutral-500">Submit a request or load one from history to see its lifecycle.</div>}<div className="mt-5 flex gap-2"><input className="min-w-0 flex-1 rounded-md border border-outline bg-black px-3 py-2 font-mono text-xs text-ink outline-none focus:border-purple" value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="0x request ID" /><button className="icon-button" title="Poll request" disabled={!key.trim() || Boolean(busy)} onClick={() => void pollRequest()}><RefreshCw size={16} className={busy === "Polling" ? "animate-spin" : ""} /></button></div></div></section>
    <section className="panel mt-6 rounded-lg p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Code2 size={17} className="text-cyan" /><h2 className="text-lg font-semibold">History</h2></div><span className="text-xs text-neutral-500">Loaded from GenLayer</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-outline text-[11px] uppercase text-neutral-500"><tr><th className="px-3 py-3">Status</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Updated</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{history.map((item) => <tr key={item.request_id} className="border-b border-outline last:border-0"><td className={`px-3 py-3 font-medium ${tone(item.execution_status ?? item.status ?? "submitted")}`}>{label(item.execution_status ?? item.status ?? "submitted")}</td><td className="px-3 py-3 font-mono text-xs">{item.amount ?? "?"} {item.token_symbol ?? "USDC"}</td><td className="px-3 py-3 text-neutral-300">{item.category ?? "Not specified"}</td><td className="px-3 py-3 text-xs text-neutral-400">{when(item.updated_at ?? item.created_at)}</td><td className="px-3 py-3"><button className="text-xs text-purple hover:text-ink" onClick={() => { setRequestId(item.request_id); setRecord(item); }}>Inspect</button></td></tr>)}{history.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-500">No requests loaded.</td></tr>}</tbody></table></div></section>
  </Shell>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-outline bg-black p-3"><div className="text-[11px] uppercase text-neutral-500">{label}</div><div className="mt-2 truncate font-mono text-sm text-ink">{value}</div></div>; }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="text-xs font-semibold uppercase text-neutral-500">{label}<input className="mt-2 w-full rounded-md border border-outline bg-black px-3 py-2 text-sm font-normal normal-case text-ink outline-none focus:border-purple" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
