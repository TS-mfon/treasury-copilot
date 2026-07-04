"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { Copy, KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { isAddress, type Address } from "viem";
import { Shell } from "@/components/Shell";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";
import { parseUsdcAmount } from "@/lib/evm";
import { generateAgentKey } from "@/lib/agent";
import { requestWeeklyUsdcDelegation, type TreasuryDelegationGrant } from "@/lib/metamaskDelegation";

const operatorAddress = process.env.NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS as Address | undefined;
const oneShotMethodId = process.env.NEXT_PUBLIC_ONE_SHOT_METHOD_ID ?? "method_pending_1shot";

export default function SetupPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [chainKey, setChainKey] = useState<SupportedChainKey>("baseSepolia");
  const [agentAddress, setAgentAddress] = useState("");
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [perTxCap, setPerTxCap] = useState("25");
  const [threshold, setThreshold] = useState("5");
  const [whitelist, setWhitelist] = useState("");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [agent, setAgent] = useState<{ privateKey: string; address: Address } | null>(null);
  const [grant, setGrant] = useState<TreasuryDelegationGrant | null>(null);
  const [status, setStatus] = useState("");

  const selectedChain = SUPPORTED_CHAINS[chainKey];
  const token = selectedChain.usdcAddress;
  const metamaskConnector = connectors.find((connector) => connector.id.toLowerCase().includes("metaMask".toLowerCase())) ?? connectors[0];
  const effectiveAgent = (agent?.address ?? agentAddress) as Address;

  const caps = useMemo(() => ({
    perTxCapAtto: parseUsdcAmount(perTxCap || "0").toString(),
    weeklyCapAtto: parseUsdcAmount(weeklyCap || "0").toString(),
    thresholdAtto: parseUsdcAmount(threshold || "0").toString(),
  }), [perTxCap, weeklyCap, threshold]);

  async function connectMetaMask() {
    if (!metamaskConnector) throw new Error("MetaMask connector is not available");
    await connect({ connector: metamaskConnector, chainId: selectedChain.chainId });
  }

  async function approveDelegation() {
    if (!address) throw new Error("Connect MetaMask first");
    if (!isAddress(effectiveAgent)) throw new Error("Enter a valid agent wallet address");
    if (!token) throw new Error(`Missing USDC address for ${selectedChain.name}`);
    if (chainId !== selectedChain.chainId) {
      await switchChainAsync({ chainId: selectedChain.chainId });
    }

    setStatus("Opening MetaMask permission request for weekly USDC delegation...");
    const result = await requestWeeklyUsdcDelegation({
      owner: address,
      agent: effectiveAgent,
      chainKey,
      token,
      weeklyAllowanceAtto: parseUsdcAmount(weeklyCap || "0"),
    });
    setGrant(result);
    setStatus("Delegation approved. Deploy a GenLayer policy with the constructor args shown below.");
  }

  return (
    <Shell>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Setup</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Connect MetaMask, delegate a weekly USDC budget to your agent, then bind that delegation to a GenLayer policy contract.
          </p>
        </div>
        <ShieldCheck className="mt-1 text-teal-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">1. Owner wallet</h2>
          <div className="mt-4">
            {isConnected ? (
              <div className="rounded-md bg-teal-50 p-3 text-sm text-teal-900">Connected: {address}</div>
            ) : (
              <button
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isConnecting || !metamaskConnector}
                onClick={connectMetaMask}
              >
                <WalletCards size={16} /> {isConnecting ? "Connecting..." : "Connect MetaMask"}
              </button>
            )}
            {connectError && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{connectError.message}</p>}
          </div>

          <h2 className="mt-8 text-lg font-semibold">2. Delegation</h2>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Chain
              <select className="field" value={chainKey} onChange={(event) => setChainKey(event.target.value as SupportedChainKey)}>
                <option value="baseSepolia">Base Sepolia</option>
                <option value="arbitrumSepolia">Arbitrum Sepolia</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Agent wallet
              <input className="field" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="0x..." />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Weekly delegated USDC
              <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} />
            </label>
          </div>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!isConnected || !isAddress(effectiveAgent)}
            onClick={approveDelegation}
          >
            <WalletCards size={16} /> Delegate weekly USDC
          </button>

          {grant && (
            <div className="mt-5 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
              <p className="font-semibold">Delegation ready</p>
              <p className="mt-2 break-all">Delegated account: {grant.delegatedAccount}</p>
              <p className="mt-2 break-all">Permission context: {grant.permissionContext}</p>
            </div>
          )}
        </section>

        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">3. GenLayer policy</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Per-request cap USDC
              <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} />
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
            Policy text
            <textarea className="field min-h-32" value={policyText} onChange={(event) => setPolicyText(event.target.value)} />
          </label>

          <h2 className="mt-8 text-lg font-semibold">4. Agent key helper</h2>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-4 py-2 text-sm font-semibold"
            onClick={() => {
              const generated = generateAgentKey();
              setAgent(generated);
              setAgentAddress(generated.address);
            }}
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

          <div className="mt-6 rounded-md bg-slate-950 p-4 text-sm text-slate-100">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Copy size={15} /> GenLayer TreasuryPolicy args</div>
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({
              authorized_agent: isAddress(effectiveAgent) ? effectiveAgent : "0x...",
              execution_reporter: operatorAddress ?? "operator env missing",
              delegated_account: grant?.delegatedAccount ?? "approve delegation first",
              token_address: token ?? "USDC env missing",
              delegation_context: grant?.permissionContext ?? "approve delegation first",
              one_shot_method_id: oneShotMethodId,
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
