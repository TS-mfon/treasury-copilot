"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gauge, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";

interface PolicyRow { policy: string; state: { authorized_agent?: string; token_address?: string; weekly_cap_atto?: string; delegation_registered?: boolean } }

export default function DashboardPage() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/owner/policies").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setPolicies(data.policies ?? []); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Connect and unlock your wallet to view policies")); }, []);
  return <Shell><section className="panel rounded-lg p-6"><div className="flex items-start justify-between"><div><div className="badge text-purple">OWNER CONSOLE</div><h1 className="mt-3 text-3xl font-semibold">Your agent treasuries</h1><p className="mt-2 text-neutral-400">Each policy, agent, and funding source is isolated on-chain.</p></div><Gauge className="text-purple" /></div>{error && <p className="mt-6 rounded-md border border-danger/40 bg-danger/10 p-3 text-danger">{error}</p>}<div className="mt-6 grid gap-4 md:grid-cols-2">{policies.map(({ policy, state }) => <article key={policy} className="rounded-lg border border-outline bg-paper p-4"><div className="flex items-center justify-between"><span className="badge text-success"><ShieldCheck size={13} className="mr-1" /> {state.delegation_registered ? "READY" : "NEEDS FUNDING"}</span><span className="font-mono text-xs text-neutral-500">{policy.slice(0, 10)}…</span></div><p className="mt-4 text-sm text-neutral-400">Agent</p><p className="font-mono text-xs text-ink">{state.authorized_agent}</p></article>)}{!error && policies.length === 0 && <p className="text-neutral-500">No agent treasury is configured yet.</p>}</div><Link href="/setup" className="mt-6 inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 font-semibold text-black">Set up an agent <ArrowRight size={16} /></Link></section></Shell>;
}
