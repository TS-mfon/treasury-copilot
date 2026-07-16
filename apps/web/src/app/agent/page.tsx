"use client";

import { useState } from "react";
import { Bot, KeyRound, Send } from "lucide-react";
import { Shell } from "@/components/Shell";
import { friendlyError } from "@/lib/errors";

export default function AgentPage() {
  const [apiKey, setApiKey] = useState("");
  const [agentAddress, setAgentAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [category, setCategory] = useState("api");
  const [justification, setJustification] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setError("");
    setStatus("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/spend", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ agent_address: agentAddress, recipient, amount, category, justification }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Request failed");
      setStatus(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="badge text-purple">AGENT API</div>
            <h1 className="mt-3 text-3xl font-semibold text-ink">Submit spend request</h1>
            <p className="mt-2 max-w-3xl text-neutral-400">
              Agents only need an API key and JSON. The platform signs the GenLayer request, executes approved payments through 1Shot, and returns the on-chain result.
            </p>
          </div>
          <Bot className="text-purple" />
        </div>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-medium text-neutral-200">
            Agent API key
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 text-neutral-500" size={16} />
              <input className="field pl-10" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="tcp_..." />
            </div>
          </label>
          <input className="field" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="Registered agent wallet address 0x..." />
          <div className="grid gap-4 md:grid-cols-3">
            <input className="field" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Recipient 0x..." />
            <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" />
            <input className="field" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
          </div>
          <textarea className="field min-h-32" value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Specific business reason, invoice, usage note, or payment context" />
          <button
            className="inline-flex w-fit items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            disabled={isSubmitting || !apiKey || !agentAddress}
            onClick={submit}
          >
            <Send size={16} /> {isSubmitting ? "Submitting..." : "Submit and execute"}
          </button>
          {error && <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          {status && <pre className="terminal max-h-[520px] overflow-auto p-4 text-xs">{status}</pre>}
        </div>
      </section>
    </Shell>
  );
}
