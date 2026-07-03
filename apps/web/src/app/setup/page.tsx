"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Copy, KeyRound, Rocket, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";
import { deployTreasuryClone, parseUsdcAmount, setTreasuryAuthorizedAgent, usdcAddressFor } from "@/lib/evm";
import { generateAgentKey } from "@/lib/agent";
import type { Address } from "viem";

export default function SetupPage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [chainKey, setChainKey] = useState<SupportedChainKey>("baseSepolia");
  const [relayer, setRelayer] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [oneShotMethodId, setOneShotMethodId] = useState("");
  const [perTxCap, setPerTxCap] = useState("25");
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [threshold, setThreshold] = useState("5");
  const [whitelist, setWhitelist] = useState("");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [agent, setAgent] = useState<{ privateKey: string; address: Address } | null>(null);
  const [status, setStatus] = useState("");

  const selectedChain = SUPPORTED_CHAINS[chainKey];
  const caps = useMemo(() => ({
    perTxCapAtto: parseUsdcAmount(perTxCap || "0").toString(),
    weeklyCapAtto: parseUsdcAmount(weeklyCap || "0").toString(),
    thresholdAtto: parseUsdcAmount(threshold || "0").toString(),
  }), [perTxCap, weeklyCap, threshold]);

  async function deployTreasury() {
    setStatus("Deploying treasury clone...");
    const token = usdcAddressFor(chainKey);
    const result = await deployTreasuryClone(chainKey, relayer as Address, token);
    setStatus(`Treasury transaction submitted: ${result.hash}`);
  }

  async function registerAgent() {
    if (!agent?.address && !relayer) throw new Error("Generate an agent or paste an agent address first");
    setStatus("Registering authorized agent on treasury...");
    const result = await setTreasuryAuthorizedAgent(chainKey, treasuryAddress as Address, (agent?.address ?? relayer) as Address);
    setStatus(`Authorized agent transaction submitted: ${result.hash}`);
  }

  return (
    <Shell>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Setup wizard</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Configure one owner, one authorized agent, one delegated treasury path, and one 1Shot method. Nothing is stored by this app.
          </p>
        </div>
        <ShieldCheck className="mt-1 text-teal-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">1. Owner wallet</h2>
          <p className="mt-1 text-sm text-slate-600">Use MetaMask for human setup and funding.</p>
          <div className="mt-4">
            {isConnected ? (
              <div className="rounded-md bg-teal-50 p-3 text-sm text-teal-900">Connected: {address}</div>
            ) : (
              <button
                className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
                onClick={() => connect({ connector: connectors[0] })}
              >
                Connect MetaMask
              </button>
            )}
          </div>

          <h2 className="mt-8 text-lg font-semibold">2. Chain and relayer</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              EVM chain
              <select className="field" value={chainKey} onChange={(event) => setChainKey(event.target.value as SupportedChainKey)}>
                <option value="baseSepolia">Base Sepolia</option>
                <option value="arbitrumSepolia">Arbitrum Sepolia</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              1Shot delegated payout executor
              <input className="field" value={relayer} onChange={(event) => setRelayer(event.target.value)} placeholder="0x..." />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Deployed treasury address
              <input className="field" value={treasuryAddress} onChange={(event) => setTreasuryAddress(event.target.value)} placeholder="0x..." />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              1Shot contract method id
              <input className="field" value={oneShotMethodId} onChange={(event) => setOneShotMethodId(event.target.value)} placeholder="Configured payout method id" />
            </label>
          </div>

          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!isConnected || !relayer}
            onClick={deployTreasury}
          >
            <Rocket size={16} /> Deploy treasury clone
          </button>
        </section>

        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">3. Spending policy</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">
              Per-tx cap USDC
              <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Weekly cap USDC
              <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Auto-approve USDC
              <input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </label>
          </div>
          <label className="mt-4 grid gap-2 text-sm font-medium">
            Optional recipient whitelist
            <input className="field" value={whitelist} onChange={(event) => setWhitelist(event.target.value)} placeholder="0xabc...,0xdef..." />
          </label>
          <label className="mt-4 grid gap-2 text-sm font-medium">
            Policy text for GenLayer LLM decisions
            <textarea className="field min-h-32" value={policyText} onChange={(event) => setPolicyText(event.target.value)} />
          </label>

          <h2 className="mt-8 text-lg font-semibold">4. Agent wallet</h2>
            <p className="mt-1 text-sm text-slate-600">Generated keys are displayed once in this browser and never sent to this app server. The agent submits to GenLayer; it does not call the payout contract directly.</p>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-4 py-2 text-sm font-semibold"
            onClick={() => setAgent(generateAgentKey())}
          >
            <KeyRound size={16} /> Generate agent key
          </button>
          {agent && (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">Save this private key now. It is not recoverable.</p>
              <p className="mt-2 break-all">Address: {agent.address}</p>
              <p className="mt-2 break-all">Private key: {agent.privateKey}</p>
            </div>
          )}

          <button
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!isConnected || !treasuryAddress || (!agent?.address && !relayer)}
            onClick={registerAgent}
          >
            <KeyRound size={16} /> Register authorized agent
          </button>

          <div className="mt-6 rounded-md bg-slate-950 p-4 text-sm text-slate-100">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Copy size={15} /> GenLayer constructor args</div>
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({
              authorized_agent: agent?.address ?? "0x...",
              execution_reporter: address ?? "0x...",
              treasury_address: treasuryAddress || "paste deployed treasury address",
              one_shot_method_id: oneShotMethodId || "method id",
              evm_chain_id: selectedChain.chainId,
              ...caps,
              policy_text: policyText,
              whitelist_csv: whitelist,
            }, null, 2)}</pre>
          </div>

          {status && <p className="mt-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700">{status}</p>}
        </section>
      </div>
    </Shell>
  );
}
