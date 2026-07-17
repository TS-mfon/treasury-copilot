"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { isAddress, type Address } from "viem";
import { Shell } from "@/components/Shell";
import { SUPPORTED_CHAINS, type SupportedChainKey, type SupportedTokenSymbol } from "@treasury-copilot/shared";
import { parseTokenAmount } from "@/lib/evm";
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
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [chainKey, setChainKey] = useState<SupportedChainKey>("baseSepolia");
  const [tokenSymbol, setTokenSymbol] = useState<SupportedTokenSymbol>("USDC");
  const [agentAddress, setAgentAddress] = useState("");
  const [policyAddress, setPolicyAddress] = useState(defaultPolicy);
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [perTxCap, setPerTxCap] = useState("25");
  const [threshold, setThreshold] = useState("5");
  const [whitelist, setWhitelist] = useState("");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [grant, setGrant] = useState<TreasuryDelegationGrant | null>(null);
  const [status, setStatus] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [isDelegating, setIsDelegating] = useState(false);

  const selectedChain = SUPPORTED_CHAINS[chainKey];
  const tokenConfig = selectedChain.tokens[tokenSymbol];
  const token = tokenConfig?.address;
  const availableConnectors = connectors.filter((connector, index, list) => (
    list.findIndex((item) => item.id === connector.id && item.name === connector.name) === index
  ));
  const preferredConnector = availableConnectors.find((connector) => connector.name.toLowerCase().includes("rabby"))
    ?? availableConnectors.find((connector) => connector.name.toLowerCase().includes("metaMask".toLowerCase()))
    ?? availableConnectors[0];
  const effectiveAgent = agentAddress as Address;
  const platformDelegate = operatorAddress ?? process.env.NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS;

  const caps = useMemo(() => ({
    perTxCapAtto: parseTokenAmount(perTxCap || "0", tokenConfig?.decimals ?? 6).toString(),
    weeklyCapAtto: parseTokenAmount(weeklyCap || "0", tokenConfig?.decimals ?? 6).toString(),
    thresholdAtto: parseTokenAmount(threshold || "0", tokenConfig?.decimals ?? 6).toString(),
  }), [perTxCap, weeklyCap, threshold, tokenConfig?.decimals]);

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
      if (!platformDelegate || !isAddress(platformDelegate)) throw new Error("Platform signer is not configured");
      if (!isAddress(effectiveAgent)) throw new Error("Enter a valid agent address");
      if (!token) throw new Error(`${tokenSymbol} is not configured for ${selectedChain.name}`);
      if (chainId !== selectedChain.chainId) {
        await switchChainAsync({ chainId: selectedChain.chainId });
      }

      setStatus(`Opening wallet permission request for weekly ${tokenSymbol} delegation...`);
      const result = await requestWeeklyUsdcDelegation({
        owner: address,
        agent: effectiveAgent,
        chainKey,
        token,
        weeklyAllowanceAtto: parseTokenAmount(weeklyCap || "0", tokenConfig?.decimals ?? 6),
        platformDelegate: platformDelegate as Address,
      });
      setGrant(result);
      setStatus("Delegation approved. Register it on the GenLayer policy so approved requests can execute through 1Shot.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("wallet_requestExecutionPermissions") || message.includes("does not exist") || message.includes("not available")) {
        setError("MetaMask rejected the ERC-7715 permission call on this chain. Update MetaMask, enable advanced permissions if available, or switch to a supported wallet/network.");
      } else {
        setError(message);
      }
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
      const ownerMessage = `Treasury Copilot setup\nowner=${address}\nagent=${effectiveAgent}\npolicy=${policyAddress}\nchain=${grant.chainId}`;
      const ownerSignature = await signMessageAsync({ message: ownerMessage });
      const setupResponse = await fetch("/api/v1/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: address,
          agent: effectiveAgent,
          policy: policyAddress,
          delegated_account: grant.delegatedAccount,
          chain_id: grant.chainId,
          token_symbol: tokenSymbol,
          owner_message: ownerMessage,
          owner_signature: ownerSignature,
        }),
      });
      const setup = await setupResponse.json();
      if (!setupResponse.ok) throw new Error(setup.error ?? "API key setup failed");
      setApiKey(setup.agent_api_key);
      setStatus("Delegation registered and agent API key issued.");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <Shell>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Setup</h1>
          <p className="mt-2 max-w-3xl text-neutral-400">
            Connect your wallet, delegate bounded token spending, set the policy, then issue an API key for your agent.
          </p>
        </div>
        <ShieldCheck className="mt-1 text-teal-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">1. Owner wallet</h2>
          <div className="mt-4">
            {isConnected ? (
              <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">Connected: {address}</div>
            ) : (
              <div className="grid gap-3">
                <button
                  className="inline-flex w-fit items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
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
                        className="rounded-md border border-outline bg-surface-high px-3 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-50"
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
                <p className="text-xs text-neutral-500">Delegation setup requires a wallet that supports ERC-7715 execution permissions.</p>
              </div>
            )}
            {connectError && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{connectError.message}</p>}
            {error && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
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
              Token
              <select className="field" value={tokenSymbol} onChange={(event) => setTokenSymbol(event.target.value as SupportedTokenSymbol)}>
                <option value="USDC">USDC</option>
                <option value="OKB">OKB</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Agent wallet address
              <input className="field" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="0x..." />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Weekly delegated {tokenSymbol}
              <input className="field" value={weeklyCap} onChange={(event) => setWeeklyCap(event.target.value)} />
            </label>
          </div>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            disabled={!isConnected || !isAddress(effectiveAgent) || isDelegating}
            onClick={approveDelegation}
          >
            <WalletCards size={16} /> {isDelegating ? "Delegating..." : "Delegate weekly USDC"}
          </button>

          {grant && (
            <div className="mt-5 rounded-md border border-success/30 bg-success/10 p-4 text-sm text-success">
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
              Per-request cap {tokenSymbol}
              <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Auto-approve {tokenSymbol}
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

          <details className="mt-6 rounded-md border border-outline bg-paper p-4 text-sm text-neutral-300">
            <summary className="cursor-pointer font-semibold text-purple">Developer policy arguments</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify({
              authorized_agent: isAddress(effectiveAgent) ? effectiveAgent : "0x...",
              execution_reporter: operatorAddress ?? "operator env missing",
              delegated_account: grant?.delegatedAccount ?? "approve delegation first",
              token_address: token ?? `${tokenSymbol} env missing`,
              delegation_context: grant?.permissionContext ?? "approve delegation first",
              evm_chain_id: selectedChain.chainId,
              ...caps,
              policy_text: policyText,
              whitelist_csv: whitelist,
            }, null, 2)}</pre>
          </details>

          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            disabled={!grant || !isAddress(policyAddress)}
            onClick={registerDelegation}
          >
            <ShieldCheck size={16} /> Register delegation and issue API key
          </button>

          {status && <p className="mt-4 rounded-md border border-outline bg-surface-high p-3 text-sm text-neutral-200">{status}</p>}
          {apiKey && (
            <div className="mt-4 rounded-md border border-purple/40 bg-purple/10 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-semibold text-purple"><KeyRound size={15} /> Agent API key</div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-ink">{apiKey}</pre>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
