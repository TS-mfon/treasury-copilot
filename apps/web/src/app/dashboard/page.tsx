"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignTypedData } from "wagmi";
import { Ban, Clipboard, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { formatUnits, isAddress, type Address } from "viem";
import { buildOwnerActionDomain, ownerActionTypes } from "@treasury-copilot/shared";
import { Shell } from "@/components/Shell";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import { friendlyError } from "@/lib/errors";
import { hashActionPayload } from "@/lib/ownerActions";

interface PolicyRow {
  policy: Address;
  binding: {
    owner: Address;
    agent: Address;
    chain_id: string;
    token_address: Address;
    token_symbol: string;
    token_decimals: string;
    active: boolean;
    api_key_version: string;
  };
  state: {
    delegation_registered?: boolean;
    weekly_cap_atto?: string;
    weekly_spent_atto?: string;
  };
}

export default function DashboardPage() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [error, setError] = useState("");
  const [busyPolicy, setBusyPolicy] = useState("");
  const [issuedKey, setIssuedKey] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/owner/policies");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not load policies");
      setPolicies(data.policies ?? []);
    } catch (cause) {
      setError(friendlyError(cause));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function keyAction(row: PolicyRow, action: "rotate" | "revoke") {
    setError("");
    setIssuedKey("");
    setBusyPolicy(row.policy);
    try {
      if (!address || address.toLowerCase() !== row.binding.owner.toLowerCase()) throw new Error("Connect the policy owner wallet");
      const registry = process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
      if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
      const signedAction = action === "revoke" ? "revoke_agent_key" : "rotate_agent_key";
      const nonce = BigInt(row.binding.api_key_version);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const payloadHash = hashActionPayload([signedAction, row.policy.toLowerCase(), nonce.toString()]);
      const signature = await signTypedDataAsync({
        domain: buildOwnerActionDomain(Number(row.binding.chain_id), registry as Address),
        types: ownerActionTypes,
        primaryType: "OwnerAction",
        message: {
          owner: address,
          action: signedAction,
          policy: row.policy,
          agent: row.binding.agent,
          chainId: BigInt(row.binding.chain_id),
          token: row.binding.token_address,
          payloadHash,
          nonce,
          deadline,
        },
      });
      const response = await fetch("/api/owner/agent-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: row.policy,
          action,
          deadline: deadline.toString(),
          owner_signature: signature,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Agent key update failed");
      if (result.agent_api_key) setIssuedKey(result.agent_api_key);
      await load();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusyPolicy("");
    }
  }

  return (
    <ProtectedOwnerPage>
      <Shell>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline pb-6">
          <div>
            <div className="badge text-purple">OWNER CONSOLE</div>
            <h1 className="mt-3 text-3xl font-semibold">Agent treasuries</h1>
            <p className="mt-2 text-neutral-400">Each agent has an isolated policy, API key version, and delegated funding binding.</p>
          </div>
          <Link href="/setup" className="inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black">
            <Plus size={16} /> Add agent
          </Link>
        </div>

        {error && <p className="mt-5 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        {issuedKey && (
          <section className="mt-6 border border-purple/40 bg-purple/10 p-5">
            <div className="flex items-center gap-2 font-semibold text-purple"><KeyRound size={16} /> Rotated API key</div>
            <p className="mt-2 text-sm text-neutral-300">This replacement key is shown once. The previous version is already invalid.</p>
            <pre className="terminal mt-4 max-h-40 overflow-auto p-3 text-xs">{issuedKey}</pre>
            <button className="mt-3 inline-flex items-center gap-2 rounded-md border border-purple/40 px-3 py-2 text-xs font-semibold text-purple" onClick={() => void navigator.clipboard.writeText(issuedKey)}>
              <Clipboard size={14} /> Copy key
            </button>
          </section>
        )}

        <div className="mt-6 grid gap-px overflow-hidden border border-outline bg-outline lg:grid-cols-2">
          {policies.map((row) => {
            const decimals = Number(row.binding.token_decimals);
            const spent = formatUnits(BigInt(row.state.weekly_spent_atto ?? "0"), decimals);
            const cap = formatUnits(BigInt(row.state.weekly_cap_atto ?? "0"), decimals);
            const ready = row.binding.active && row.state.delegation_registered;
            return (
              <article key={row.policy} className="bg-surface-low p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className={`badge ${ready ? "text-success" : "text-danger"}`}>
                    <ShieldCheck size={13} className="mr-1" /> {ready ? "READY" : row.binding.active ? "NEEDS DELEGATION" : "REVOKED"}
                  </span>
                  <span className="font-mono text-xs text-neutral-500">KEY V{row.binding.api_key_version}</span>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase text-neutral-500">Agent</p>
                    <p className="mt-1 break-all font-mono text-xs text-neutral-200">{row.binding.agent}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-neutral-500">Weekly usage</p>
                    <p className="mt-1 font-mono text-sm">{spent} / {cap} {row.binding.token_symbol}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-outline pt-4">
                  <button
                    className="inline-flex items-center gap-2 rounded-md border border-outline px-3 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-50"
                    disabled={!row.binding.active || busyPolicy === row.policy}
                    onClick={() => void keyAction(row, "rotate")}
                  >
                    <RefreshCw size={14} /> Rotate key
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-md border border-danger/40 px-3 py-2 text-xs font-semibold text-danger disabled:opacity-50"
                    disabled={!row.binding.active || busyPolicy === row.policy}
                    onClick={() => void keyAction(row, "revoke")}
                  >
                    <Ban size={14} /> Revoke agent
                  </button>
                </div>
              </article>
            );
          })}
          {!error && policies.length === 0 && (
            <div className="bg-surface-low p-8 text-sm text-neutral-500">No agent treasury is configured yet.</div>
          )}
        </div>
      </Shell>
    </ProtectedOwnerPage>
  );
}
