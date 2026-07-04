"use client";

import { useMemo, useState } from "react";
import { Bot, Send } from "lucide-react";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { Shell } from "@/components/Shell";
import { executeApprovedRequest } from "@/lib/relay";
import { justificationHash } from "@/lib/agent";
import { parseUsdcAmount } from "@/lib/evm";
import { writePolicyMethod } from "@/lib/genlayer";
import { signWithPlatformAgent } from "@/lib/agentSigner";
import { friendlyError } from "@/lib/errors";
import { type TreasuryRequestMessage } from "@treasury-copilot/shared";

const submittedPrefix = "treasury-copilot:submitted:";

export default function AgentTestPage() {
  const [chainId, setChainId] = useState("84532");
  const [policy, setPolicy] = useState(process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "");
  const [delegatedAccount, setDelegatedAccount] = useState("");
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

      setStatus("Signing request with the platform agent wallet...");
      const amountAtto = parseUsdcAmount(amount);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const message: TreasuryRequestMessage = {
        policy: policy as Address,
        delegatedAccount: delegatedAccount as Address,
        recipient: recipient as Address,
        amountAtto,
        category,
        justificationHash: justificationHash(justification),
        requestId: requestId as Hex,
        deadline,
      };
      const { signature, signer } = await signWithPlatformAgent({ chainId: Number(chainId), policy: policy as Address, message });

      setStatus(`Submitting to GenLayer as ${signer}...`);
      const result = await writePolicyMethod(policy, "submit_request", [
        recipient,
        amountAtto.toString(),
        category,
        justification,
        message.justificationHash,
        signature,
        requestId,
        deadline.toString(),
      ]);

      window.localStorage.setItem(duplicateKey, new Date().toISOString());

      if (result.verdict !== "approved") {
        setStatus(JSON.stringify(result, null, 2));
        return;
      }

      setStatus("Approved by GenLayer. Executing with 1Shot relay...");
      const relayResult = await executeApprovedRequest(result.relay);
      setStatus(`1Shot executed ${relayResult.tx_hash}. Recording execution on GenLayer...`);
      const record = await writePolicyMethod(policy, relayResult.genlayer_record_execution.method, relayResult.genlayer_record_execution.args);
      setStatus(JSON.stringify({ genlayer: result, relay: relayResult, record }, null, 2));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Shell>
      <section className="panel rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-ink">Agent request submitter</h1>
            <p className="mt-2 max-w-3xl text-slate-600">Signs a request with the agent key, submits it to GenLayer for policy evaluation, and sends only approved delegation payloads to our 1Shot executor.</p>
          </div>
          <Bot className="text-teal-700" />
        </div>

        <div className="mt-6 grid gap-4">
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
