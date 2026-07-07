"use client";

import { useMemo, useState } from "react";
import { Bot, Search, Send } from "lucide-react";
import { keccak256, stringToHex } from "viem";
import { Shell } from "@/components/Shell";
import { friendlyError } from "@/lib/errors";
import { registryGetPolicy, registryPoliciesForAgent, registryPoliciesForOwner } from "@/lib/genlayer";

const submittedPrefix = "treasury-copilot:submitted:";

export default function AgentTestPage() {
  const [chainId, setChainId] = useState("84532");
  const [policy, setPolicy] = useState(process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "");
  const [delegatedAccount, setDelegatedAccount] = useState("");
  const [lookupAddress, setLookupAddress] = useState(process.env.NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS ?? "");
  const [discoveredPolicies, setDiscoveredPolicies] = useState<string[]>([]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1");
  const [category, setCategory] = useState("api");
  const [justification, setJustification] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestFingerprint = useMemo(
    () => keccak256(stringToHex(`${policy}:${delegatedAccount}:${recipient}:${amount}:${category}:${justification}`)),
    [policy, delegatedAccount, recipient, amount, category, justification],
  );
  const requestId = requestFingerprint;

  async function submit() {
    setError("");
    setIsSubmitting(true);
    try {
      const duplicateKey = `${submittedPrefix}${requestFingerprint}`;
      if (window.localStorage.getItem(duplicateKey)) {
        throw new Error("duplicate payload");
      }

      setStatus("Submitting to GenLayer. Approved requests execute automatically through 1Shot...");
      const response = await fetch("/api/submit-agent-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: Number(chainId), policy, delegatedAccount, recipient, amount, category, justification }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Request failed");
      window.localStorage.setItem(duplicateKey, new Date().toISOString());
      setStatus(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function discover(mode: "agent" | "owner") {
    setError("");
    setStatus("");
    try {
      const policies = mode === "agent"
        ? await registryPoliciesForAgent(lookupAddress)
        : await registryPoliciesForOwner(lookupAddress);
      setDiscoveredPolicies(policies);
      if (policies[0]) {
        setPolicy(policies[0]);
        const metadata = await registryGetPolicy(policies[0]);
        if (metadata.delegated_account) setDelegatedAccount(metadata.delegated_account);
        if (metadata.chain_id) setChainId(metadata.chain_id);
      }
      setStatus(policies.length > 0 ? `Discovered ${policies.length} policy record(s).` : "No policy records found for that address.");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-ink">Agent request submitter</h1>
            <p className="mt-2 max-w-3xl text-slate-600">Submits one payload to GenLayer. If GenLayer approves it, the backend immediately forwards the approved relay payload to 1Shot and records the tx hash.</p>
          </div>
          <Bot className="text-teal-700" />
        </div>

        <div className="mt-6 grid gap-4">
          <div className="rounded-md border border-slate-900/10 bg-slate-50 p-4">
            <label className="grid gap-2 text-sm font-medium">
              Discover policy by owner or platform signer
              <input className="field" value={lookupAddress} onChange={(event) => setLookupAddress(event.target.value)} placeholder="0x owner or platform signer" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-3 py-2 text-xs font-semibold" onClick={() => discover("agent")}>
                <Search size={14} /> By platform signer
              </button>
              <button className="inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-3 py-2 text-xs font-semibold" onClick={() => discover("owner")}>
                <Search size={14} /> By owner
              </button>
            </div>
            {discoveredPolicies.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {discoveredPolicies.map((item) => (
                  <button key={item} className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-700" onClick={async () => {
                    setPolicy(item);
                    const metadata = await registryGetPolicy(item);
                    if (metadata.delegated_account) setDelegatedAccount(metadata.delegated_account);
                    if (metadata.chain_id) setChainId(metadata.chain_id);
                  }}>
                    {item.slice(0, 10)}...
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <input className="field" value={chainId} onChange={(event) => setChainId(event.target.value)} placeholder="EVM chain id" />
            <input className="field" value={policy} onChange={(event) => setPolicy(event.target.value)} placeholder="GenLayer policy address" />
            <input className="field" value={delegatedAccount} onChange={(event) => setDelegatedAccount(event.target.value)} placeholder="Delegated account address" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <input className="field" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Recipient 0x..." />
            <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="USDC amount" />
            <input className="field" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
          </div>
          <textarea className="field min-h-32" value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Agent justification" />
          <button
            className="inline-flex w-fit items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isSubmitting}
            onClick={submit}
          >
            <Send size={16} /> {isSubmitting ? "Submitting..." : "Submit and execute"}
          </button>
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {status && <pre className="overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{status}</pre>}
        </div>
      </section>
    </Shell>
  );
}
