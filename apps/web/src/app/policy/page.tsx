"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Shell } from "@/components/Shell";
import { parseUsdcAmount } from "@/lib/evm";
import { writePolicyMethod } from "@/lib/genlayer";
import { friendlyError } from "@/lib/errors";

export default function PolicyPage() {
  const [policyAddress, setPolicyAddress] = useState(process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "");
  const [authorizedAgent, setAuthorizedAgent] = useState("0xEd9EDd8586b20524CafA4F568413C504C9B03172");
  const [executionReporter, setExecutionReporter] = useState("0xEd9EDd8586b20524CafA4F568413C504C9B03172");
  const [perTxCap, setPerTxCap] = useState("25");
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [threshold, setThreshold] = useState("5");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setError("");
    setIsSaving(true);
    try {
      setStatus("Submitting policy update to GenLayer...");
      const result = await writePolicyMethod(policyAddress, "update_policy", [
        authorizedAgent,
        executionReporter,
        parseUsdcAmount(perTxCap).toString(),
        parseUsdcAmount(weeklyCap).toString(),
        parseUsdcAmount(threshold).toString(),
        policyText,
      ]);
      setStatus(JSON.stringify(result));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-5">
        <h1 className="text-3xl font-semibold text-ink">Policy editor</h1>
        <p className="mt-2 max-w-3xl text-slate-600">Owner-only GenLayer update. Changes apply going forward and do not re-judge past requests.</p>
        <div className="mt-6 grid gap-4">
          <input className="field" value={policyAddress} onChange={(event) => setPolicyAddress(event.target.value)} placeholder="GenLayer policy address" />
          <div className="grid gap-4 md:grid-cols-2">
            <input className="field" value={authorizedAgent} onChange={(event) => setAuthorizedAgent(event.target.value)} placeholder="Authorized agent address" />
            <input className="field" value={executionReporter} onChange={(event) => setExecutionReporter(event.target.value)} placeholder="Execution reporter address" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} placeholder="Per-tx cap USDC" />
            <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} placeholder="Weekly cap USDC" />
            <input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Auto approve USDC" />
          </div>
          <textarea className="field min-h-44" value={policyText} onChange={(event) => setPolicyText(event.target.value)} placeholder="Policy text" />
          <button className="inline-flex w-fit items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={isSaving} onClick={save}>
            <Save size={16} /> {isSaving ? "Saving..." : "Save policy"}
          </button>
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {status && <pre className="overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{status}</pre>}
        </div>
      </section>
    </Shell>
  );
}
