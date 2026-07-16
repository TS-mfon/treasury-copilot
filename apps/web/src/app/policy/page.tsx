"use client";

import { useState } from "react";
import { Save, Settings } from "lucide-react";
import { Shell } from "@/components/Shell";
import { friendlyError } from "@/lib/errors";

export default function PolicyPage() {
  const [policy, setPolicy] = useState("");
  const [perTxCap, setPerTxCap] = useState("25");
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [threshold, setThreshold] = useState("5");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setError("");
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/owner/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy,
          per_tx_cap: perTxCap,
          weekly_cap: weeklyCap,
          auto_approve_threshold: threshold,
          policy_text: policyText,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Policy update failed");
      setStatus(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="badge text-purple">OWNER CONTROL</div>
            <h1 className="mt-3 text-3xl font-semibold text-ink">Policy editor</h1>
            <p className="mt-2 max-w-3xl text-neutral-400">Policy changes require the owner wallet signature and apply only to future requests.</p>
          </div>
          <Settings className="text-purple" />
        </div>
        <div className="mt-6 grid gap-4">
          <input className="field" value={policy} onChange={(event) => setPolicy(event.target.value)} placeholder="Your policy address 0x..." />
          <div className="grid gap-4 md:grid-cols-3">
            <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} placeholder="Per-request cap" />
            <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} placeholder="Weekly cap" />
            <input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Auto approve threshold" />
          </div>
          <textarea className="field min-h-44" value={policyText} onChange={(event) => setPolicyText(event.target.value)} placeholder="Policy text" />
          <button className="inline-flex w-fit items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={isSaving || !policy} onClick={save}>
            <Save size={16} /> {isSaving ? "Saving..." : "Save policy"}
          </button>
          {error && <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          {status && <pre className="terminal overflow-auto p-4 text-xs">{status}</pre>}
        </div>
      </section>
    </Shell>
  );
}
