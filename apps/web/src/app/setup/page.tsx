"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { Copy, KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { isAddress, type Address } from "viem";
import { Shell } from "@/components/Shell";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";
import { parseUsdcAmount } from "@/lib/evm";
import { requestWeeklyUsdcDelegation, type TreasuryDelegationGrant } from "@/lib/metamaskDelegation";
import { friendlyError } from "@/lib/errors";

const operatorAddress = process.env.NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS as Address | undefined;
const defaultPolicy = process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "";

function jsonWithBigInt(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));
}

export default function SetupPage() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [chainKey, setChainKey] = useState<SupportedChainKey>("baseSepolia");
  const [agentAddress, setAgentAddress] = useState(operatorAddress ?? "");
  const [policyAddress, setPolicyAddress] = useState(defaultPolicy);
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [perTxCap, setPerTxCap] = useState("25");
  const [threshold, setThreshold] = useState("5");
  const [whitelist, setWhitelist] = useState("");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [grant, setGrant] = useState<TreasuryDelegationGrant | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isDelegating, setIsDelegating] = useState(false);

  const selectedChain = SUPPORTED_CHAINS[chainKey];
  const token = selectedChain.usdcAddress;
  const availableConnectors = connectors.filter((connector, index, list) => (
    list.findIndex((item) => item.id === connector.id && item.name === connector.name) === index
  ));
  const preferredConnector = availableConnectors.find((connector) => connector.name.toLowerCase().includes("rabby"))
    ?? availableConnectors.find((connector) => connector.name.toLowerCase().includes("metaMask".toLowerCase()))
    ?? availableConnectors[0];
  const effectiveAgent = agentAddress as Address;

  const caps = useMemo(() => ({
    perTxCapAtto: parseUsdcAmount(perTxCap || "0").toString(),
    weeklyCapAtto: parseUsdcAmount(weeklyCap || "0").toString(),
    thresholdAtto: parseUsdcAmount(threshold || "0").toString(),
  }), [perTxCap, weeklyCap, threshold]);

  async function connectMetaMask() {
    setError("");
    try {
      if (!preferredConnector) throw new Error("No injected wallet was detected. Install Rabby, MetaMask, or another EIP-1193 wallet.");
      await connect({ connector: preferredConnector, chainId: selectedChain.chainId });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function approveDelegation() {
    setError("");
    setIsDelegating(true);
    try {
      if (!address) throw new Error("Connect MetaMask first");
      if (!isAddress(effectiveAgent)) throw new Error("Enter a valid platform signer address");
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
      setStatus("Delegation approved. Register it on the GenLayer policy so approved requests can execute through 1Shot.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsDelegating(false);
    }
  }

  async function registerDelegation() {
    setError("");
    try {
      if (!grant) throw new Error("Approve delegation first");
      if (!isAddress(policyAddress)) throw new Error("Enter a valid GenLayer policy address");
      setStatus("Registering delegation payload on GenLayer...");
      const response = await fetch("/api/register-delegation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: jsonWithBigInt({
          policy: policyAddress,
          chainId: grant.chainId,
          delegatedAccount: grant.delegatedAccount,
          token: grant.token,
          permissionContext: grant.permissionContext,
          delegationPayload: grant.raw,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Delegation registration failed");
      setStatus(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <Shell>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Setup</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Connect a wallet, create a constrained weekly USDC delegation, then bind that permission to a GenLayer policy contract.
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
              <div className="grid gap-3">
                <button
                  className="inline-flex w-fit items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={isConnecting || !preferredConnector}
                  onClick={connectMetaMask}
                >
                  <WalletCards size={16} /> {isConnecting ? "Connecting..." : `Connect ${preferredConnector?.name ?? "wallet"}`}
                </button>
                {availableConnectors.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {availableConnectors.map((connector) => (
                      <button
                        key={`${connector.uid}-${connector.id}`}
                        className="rounded-md border border-slate-900/15 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        disabled={isConnecting}
                        onClick={() => {
                          setError("");
                          connect({ connector, chainId: selectedChain.chainId });
                        }}
                      >
                        {connector.name}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-500">Rabby and other injected wallets can connect. Delegation setup requires a wallet that supports ERC-7715 execution permissions.</p>
              </div>
            )}
            {connectError && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{connectError.message}</p>}
            {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
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
              Platform signer wallet
              <input className="field" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="0x..." />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Weekly delegated USDC
              <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} />
            </label>
          </div>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!isConnected || !isAddress(effectiveAgent) || isDelegating}
            onClick={approveDelegation}
          >
            <WalletCards size={16} /> {isDelegating ? "Delegating..." : "Delegate weekly USDC"}
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
            GenLayer policy address
            <input className="field" value={policyAddress} onChange={(event) => setPolicyAddress(event.target.value)} placeholder="0x..." />
          </label>
          <label className="mt-4 grid gap-2 text-sm font-medium">
            Optional recipient whitelist
            <input className="field" value={whitelist} onChange={(event) => setWhitelist(event.target.value)} placeholder="0xabc...,0xdef..." />
          </label>
          <label className="mt-4 grid gap-2 text-sm font-medium">
            Policy text
            <textarea className="field min-h-32" value={policyText} onChange={(event) => setPolicyText(event.target.value)} />
          </label>

          <h2 className="mt-8 text-lg font-semibold">4. Platform signer</h2>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-4 py-2 text-sm font-semibold"
            onClick={() => {
              if (operatorAddress) setAgentAddress(operatorAddress);
            }}
            disabled={!operatorAddress}
          >
            <KeyRound size={16} /> Use platform signer
          </button>
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
            <p className="font-semibold">This backend signer can redeem only the constrained delegation that the owner approves.</p>
            <p className="mt-2 break-all">Address: {operatorAddress ?? "NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS is not configured"}</p>
            <p className="mt-2 text-xs leading-5">It should not receive custody of funds. It is the redeemer for a token, chain, amount, and time-bounded permission, and requests still require GenLayer approval before 1Shot execution.</p>
          </div>

          <div className="mt-6 rounded-md bg-slate-950 p-4 text-sm text-slate-100">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Copy size={15} /> GenLayer TreasuryPolicy args</div>
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({
              authorized_agent: isAddress(effectiveAgent) ? effectiveAgent : "0x...",
              execution_reporter: operatorAddress ?? "operator env missing",
              delegated_account: grant?.delegatedAccount ?? "approve delegation first",
              token_address: token ?? "USDC env missing",
              delegation_context: grant?.permissionContext ?? "approve delegation first",
              one_shot_relay_mode: "hosted-erc7710-json-rpc",
              one_shot_methods: ["relayer_getCapabilities", "relayer_getFeeData", "relayer_estimate7710Transaction", "relayer_send7710Transaction", "relayer_getStatus"],
              evm_chain_id: selectedChain.chainId,
              ...caps,
              policy_text: policyText,
              whitelist_csv: whitelist,
            }, null, 2)}</pre>
          </div>

          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!grant || !isAddress(policyAddress)}
            onClick={registerDelegation}
          >
            <ShieldCheck size={16} /> Register delegation on GenLayer
          </button>

          {status && <p className="mt-4 rounded-md bg-slate-100 p-3 text-sm text-slate-700">{status}</p>}
        </section>
      </div>
    </Shell>
  );
}
