"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { ListChecks, Plus, Save, Settings } from "lucide-react";
import { formatUnits, isAddress, type Address } from "viem";
import {
  buildOwnerActionDomain,
  ownerActionTypes,
} from "@treasury-copilot/shared";
import { Shell } from "@/components/Shell";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import { friendlyError } from "@/lib/errors";
import { hashActionPayload, hashPolicyUpdateActionPayload } from "@/lib/ownerActions";
import { parseTokenAmount } from "@/lib/evm";

interface PolicyRow {
  policy: Address;
  binding: {
    agent: Address;
    token_address: Address;
    token_symbol: string;
    token_decimals: string;
    chain_id: string;
  };
  state: {
    contract_version: string;
    owner: Address;
    per_tx_cap_atto: string;
    weekly_cap_atto: string;
    policy_text: string;
    policy_nonce: string;
    whitelist_enabled: boolean;
  };
}

export default function PolicyPage() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState("");
  const [perTxCap, setPerTxCap] = useState("");
  const [weeklyCap, setWeeklyCap] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistRecipient, setWhitelistRecipient] = useState("");
  const [whitelistAllowed, setWhitelistAllowed] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selected = useMemo(
    () => policies.find((row) => row.policy.toLowerCase() === selectedPolicy.toLowerCase()),
    [policies, selectedPolicy],
  );

  useEffect(() => {
    void fetch("/api/owner/policies")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not load policies");
        const rows = result.policies ?? [];
        setPolicies(rows);
        if (rows[0]) setSelectedPolicy(rows[0].policy);
      })
      .catch((cause) => setError(friendlyError(cause)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const decimals = Number(selected.binding.token_decimals);
    setPerTxCap(formatUnits(BigInt(selected.state.per_tx_cap_atto), decimals));
    setWeeklyCap(formatUnits(BigInt(selected.state.weekly_cap_atto), decimals));
    setPolicyText(selected.state.policy_text);
    setWhitelistEnabled(Boolean(selected.state.whitelist_enabled));
  }, [selected]);

  async function save() {
    setError("");
    setStatus("");
    setIsSaving(true);
    try {
      if (!selected || !address) throw new Error("Connect the owner wallet and select a policy");
      if (address.toLowerCase() !== selected.state.owner.toLowerCase()) throw new Error("Connected wallet does not own this policy");
      const registry = process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
      if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
      const decimals = Number(selected.binding.token_decimals);
      const perTxUnits = parseTokenAmount(perTxCap, decimals);
      const weeklyUnits = parseTokenAmount(weeklyCap, decimals);
      const nonce = BigInt(selected.state.policy_nonce);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const payloadHash = hashPolicyUpdateActionPayload({
        perTxCapUnits: perTxUnits.toString(),
        weeklyCapUnits: weeklyUnits.toString(),
        policyText: policyText.trim(),
      });
      const signature = await signTypedDataAsync({
        domain: buildOwnerActionDomain(Number(selected.binding.chain_id), registry as Address),
        types: ownerActionTypes,
        primaryType: "OwnerAction",
        message: {
          owner: address,
          action: "update_policy",
          policy: selected.policy,
          agent: selected.binding.agent,
          chainId: BigInt(selected.binding.chain_id),
          token: selected.binding.token_address,
          payloadHash,
          nonce,
          deadline,
        },
      });
      const response = await fetch("/api/owner/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: selected.policy,
          token_decimals: decimals,
          per_tx_cap: perTxCap,
          weekly_cap: weeklyCap,
          policy_text: policyText,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
          owner_signature: signature,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Policy update failed");
      setPolicies((rows) => rows.map((row) => row.policy === selected.policy ? { ...row, state: result.state } : row));
      setStatus("Policy updated on GenLayer. New limits apply to future requests.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function updateWhitelist(action: "set_whitelist_enabled" | "set_whitelist_entry") {
    setError("");
    setStatus("");
    setIsSaving(true);
    try {
      if (!selected || !address) throw new Error("Connect the owner wallet and select a policy");
      if (address.toLowerCase() !== selected.state.owner.toLowerCase()) throw new Error("Connected wallet does not own this policy");
      const registry = process.env.NEXT_PUBLIC_GENLAYER_REGISTRY;
      if (!registry || !isAddress(registry)) throw new Error("Treasury registry is not configured");
      if (action === "set_whitelist_entry" && !isAddress(whitelistRecipient)) throw new Error("Enter a valid recipient address");
      const nonce = BigInt(selected.state.policy_nonce);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const payloadHash = action === "set_whitelist_enabled"
        ? hashActionPayload([whitelistEnabled])
        : hashActionPayload([whitelistRecipient.toLowerCase(), whitelistAllowed]);
      const signature = await signTypedDataAsync({
        domain: buildOwnerActionDomain(Number(selected.binding.chain_id), registry as Address),
        types: ownerActionTypes,
        primaryType: "OwnerAction",
        message: {
          owner: address,
          action,
          policy: selected.policy,
          agent: selected.binding.agent,
          chainId: BigInt(selected.binding.chain_id),
          token: selected.binding.token_address,
          payloadHash,
          nonce,
          deadline,
        },
      });
      const response = await fetch("/api/owner/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          policy: selected.policy,
          enabled: whitelistEnabled,
          recipient: whitelistRecipient,
          allowed: whitelistAllowed,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
          owner_signature: signature,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Whitelist update failed");
      setPolicies((rows) => rows.map((row) => row.policy === selected.policy ? { ...row, state: result.state } : row));
      setStatus(action === "set_whitelist_enabled" ? "Whitelist mode updated on GenLayer." : "Recipient rule updated on GenLayer.");
      if (action === "set_whitelist_entry") setWhitelistRecipient("");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ProtectedOwnerPage><Shell>
      <section className="panel rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="badge text-purple">OWNER CONTROL</div>
            <h1 className="mt-3 text-3xl font-semibold text-ink">Policy editor</h1>
            <p className="mt-2 max-w-3xl text-neutral-400">Every mutation requires a fresh owner signature and applies only to future requests.</p>
          </div>
          <Settings className="text-purple" />
        </div>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Agent policy
            <select className="field" value={selectedPolicy} onChange={(event) => setSelectedPolicy(event.target.value)}>
              {policies.map((row) => (
                <option key={row.policy} value={row.policy}>
                  {row.binding.token_symbol} · {row.binding.agent.slice(0, 10)}...
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">Per request cap<input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Weekly cap<input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} /></label>
          </div>
          {Number(selected?.state.contract_version ?? "0") < 5 && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              Register the delegation again to migrate this policy to V5 immediate review. V4 requests still work through automatic recovery; V2 and V3 are blocked.
            </p>
          )}
          <label className="grid gap-2 text-sm font-medium">
            Policy text
            <textarea className="field min-h-44" value={policyText} onChange={(event) => setPolicyText(event.target.value)} />
          </label>
          <button className="inline-flex w-fit items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={isSaving || !selected} onClick={save}>
            <Save size={16} /> {isSaving ? "Waiting for signature..." : "Sign and save"}
          </button>

          <div className="mt-4 border-t border-outline pt-6">
            <div className="flex items-center gap-2">
              <ListChecks size={17} className="text-purple" />
              <h2 className="font-semibold">Recipient whitelist</h2>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={whitelistEnabled} onChange={(event) => setWhitelistEnabled(event.target.checked)} />
                Enforce whitelist for future requests
              </label>
              <button
                className="rounded-md border border-outline px-3 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-50"
                disabled={isSaving || !selected}
                onClick={() => void updateWhitelist("set_whitelist_enabled")}
              >
                Sign and apply
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <input className="field" value={whitelistRecipient} onChange={(event) => setWhitelistRecipient(event.target.value)} placeholder="0x recipient address" />
              <select className="field md:w-36" value={whitelistAllowed ? "allow" : "deny"} onChange={(event) => setWhitelistAllowed(event.target.value === "allow")}>
                <option value="allow">Allow</option>
                <option value="deny">Remove</option>
              </select>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md bg-surface-high px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                disabled={isSaving || !selected || !isAddress(whitelistRecipient)}
                onClick={() => void updateWhitelist("set_whitelist_entry")}
              >
                <Plus size={15} /> Update
              </button>
            </div>
          </div>
          {error && <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          {status && <p className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">{status}</p>}
        </div>
      </section>
    </Shell></ProtectedOwnerPage>
  );
}
