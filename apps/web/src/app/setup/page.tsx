"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useSignTypedData } from "wagmi";
import { CheckCircle2, Clipboard, Fuel, KeyRound, LoaderCircle, ShieldCheck, WalletCards } from "lucide-react";
import { isAddress, zeroAddress, type Address } from "viem";
import { Shell } from "@/components/Shell";
import { ProtectedOwnerPage } from "@/components/ProtectedOwnerPage";
import {
  buildOwnerActionDomain,
  ownerActionTypes,
  SUPPORTED_CHAINS,
  type SupportedChainKey,
} from "@treasury-copilot/shared";
import { parseTokenAmount } from "@/lib/evm";
import { requestWeeklyUsdcDelegation, type TreasuryDelegationGrant } from "@/lib/metamaskDelegation";
import { friendlyError } from "@/lib/errors";
import { canonicalJson, hashActionPayload } from "@/lib/ownerActions";

type DelegationChainKey = Extract<SupportedChainKey, "baseSepolia" | "base">;

type SetupResult = {
  policy: Address;
  deployment_tx_hash: string | null;
  delegation_tx_hash: string;
};

const delegationChains: Array<{
  key: DelegationChainKey;
  executionAvailable: boolean;
}> = [
  { key: "baseSepolia", executionAvailable: true },
  { key: "base", executionAvailable: false },
];

function operatorForChain(chainKey: DelegationChainKey) {
  if (chainKey === "base") {
    return process.env.NEXT_PUBLIC_BASE_TREASURY_OPERATOR_ADDRESS as Address | undefined;
  }
  return (
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_TREASURY_OPERATOR_ADDRESS
    ?? process.env.NEXT_PUBLIC_TREASURY_OPERATOR_ADDRESS
  ) as Address | undefined;
}

export default function SetupPage() {
  const { address, connector, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [chainKey, setChainKey] = useState<DelegationChainKey>("baseSepolia");
  const tokenSymbol = "USDC" as const;
  const [agentAddress, setAgentAddress] = useState("");
  const [weeklyCap, setWeeklyCap] = useState("100");
  const [perTxCap, setPerTxCap] = useState("25");
  const [threshold, setThreshold] = useState("5");
  const [whitelist, setWhitelist] = useState("");
  const [policyText, setPolicyText] = useState("Routine API bills, contributor reimbursements, software subscriptions, and grants are allowed when the justification is specific and business-related.");
  const [grant, setGrant] = useState<TreasuryDelegationGrant | null | undefined>(null);
  const [status, setStatus] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [isDelegating, setIsDelegating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);

  const selectedChain = SUPPORTED_CHAINS[chainKey];
  const tokenConfig = selectedChain.tokens[tokenSymbol];
  const token = tokenConfig?.address;
  const availableConnectors = connectors.filter((connector, index, list) => (
    list.findIndex((item) => item.id === connector.id && item.name === connector.name) === index
  ));
  const preferredConnector = availableConnectors.find((connector) => connector.name.toLowerCase().includes("metamask"))
    ?? availableConnectors[0];
  const effectiveAgent = agentAddress as Address;
  const platformDelegate = operatorForChain(chainKey);
  const executionAvailable = delegationChains.find((chain) => chain.key === chainKey)?.executionAvailable === true;

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
    setSetupError("");
    setSetupResult(null);
    setApiKey("");
    setIsDelegating(true);
    try {
      if (!executionAvailable) {
        throw new Error(`${selectedChain.name} automatic execution is unavailable because 1Shot does not currently advertise chain ${selectedChain.chainId}.`);
      }
      if (!address) throw new Error("Connect MetaMask first");
      if (!platformDelegate || !isAddress(platformDelegate)) throw new Error("Platform signer is not configured");
      if (!isAddress(effectiveAgent)) throw new Error("Enter a valid agent address");
      if (!token) throw new Error(`${tokenSymbol} is not configured for ${selectedChain.name}`);

      const ownerAddress = address;
      const tokenAddress = token;
      const weeklyAllowanceAtto = parseTokenAmount(weeklyCap || "0", tokenConfig?.decimals ?? 6);
      const walletProvider = await connector?.getProvider();
      if (!walletProvider) throw new Error("The connected MetaMask provider is unavailable. Reconnect the wallet and retry.");

      setStatus(`Confirming ${selectedChain.name}, inspecting wallet capabilities, then opening the permission request...`);
      const result = await requestWeeklyUsdcDelegation({
        owner: ownerAddress,
        agent: effectiveAgent,
        chainKey,
        token: tokenAddress,
        weeklyAllowanceAtto,
        platformDelegate: platformDelegate as Address,
        provider: walletProvider,
      });
      setGrant(result);
      setStatus("Delegation approved. Register it on the GenLayer policy so approved requests can execute through 1Shot.");
    } catch (err) {
      const message = friendlyError(err);
      setError(message);
      console.error("[approveDelegation] ERC-7715 request failed", {
        cause: message,
        chain: selectedChain.name,
        chainId: selectedChain.chainId,
        raw: err,
      });
    } finally {
      setIsDelegating(false);
    }
  }

  async function registerDelegation() {
    setSetupError("");
    setSetupResult(null);
    setApiKey("");
    setIsRegistering(true);
    try {
      if (!grant) throw new Error("Approve delegation first");
      if (!address) throw new Error("Owner wallet is not connected");
      setStatus("Loading the current GenLayer registry nonce...");
      const setupChallenge = await fetch("/api/v1/setup");
      const challenge = await setupChallenge.json();
      if (!setupChallenge.ok) throw new Error(challenge.message ?? challenge.error ?? "Could not load setup authorization");

      const serializedDelegation = canonicalJson(grant.raw);
      const payloadHash = hashActionPayload([
        effectiveAgent.toLowerCase(),
        grant.delegatedAccount.toLowerCase(),
        grant.chainId,
        grant.token.toLowerCase(),
        tokenSymbol,
        grant.permissionContext,
        serializedDelegation,
        caps.perTxCapAtto,
        caps.weeklyCapAtto,
        caps.thresholdAtto,
        policyText.trim(),
        whitelist.trim(),
      ]);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const nonce = BigInt(challenge.nonce);
      setStatus("Confirm the owner authorization in MetaMask.");
      const ownerSignature = await signTypedDataAsync({
        domain: buildOwnerActionDomain(grant.chainId, challenge.registry as Address),
        types: ownerActionTypes,
        primaryType: "OwnerAction",
        message: {
          owner: address,
          action: "setup_agent",
          policy: zeroAddress,
          agent: effectiveAgent,
          chainId: BigInt(grant.chainId),
          token: grant.token,
          payloadHash,
          nonce,
          deadline,
        },
      });
      setStatus("Deploying the agent policy, registering its funding binding, and storing the delegation on GenLayer. This can take several minutes.");
      const setupResponse = await fetch("/api/v1/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: canonicalJson({
          owner: address,
          agent: effectiveAgent,
          delegated_account: grant.delegatedAccount,
          chain_id: grant.chainId,
          token_symbol: tokenSymbol,
          permission_context: grant.permissionContext,
          delegation_payload: grant.raw,
          per_tx_cap: perTxCap,
          weekly_cap: weeklyCap,
          auto_approve_threshold: threshold,
          whitelist,
          policy_text: policyText,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
          owner_signature: ownerSignature,
        }),
      });
      const setup = await setupResponse.json();
      if (!setupResponse.ok) throw new Error(setup.message ?? setup.error ?? "API key setup failed");
      setApiKey(setup.agent_api_key);
      setSetupResult({
        policy: setup.policy as Address,
        deployment_tx_hash: setup.deployment_tx_hash,
        delegation_tx_hash: setup.delegation_tx_hash,
      });
      setStatus("Agent treasury registered successfully. Store the API key now; it will not be shown again.");
    } catch (err) {
      const message = friendlyError(err);
      setSetupError(message);
      setStatus("");
      console.error("[registerDelegation] setup failed", { error: err, message });
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <ProtectedOwnerPage><Shell>
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
              <select
                className="field"
                value={chainKey}
                onChange={(event) => {
                  setChainKey(event.target.value as DelegationChainKey);
                  setGrant(null);
                  setError("");
                  setSetupError("");
                  setSetupResult(null);
                  setApiKey("");
                  setStatus("");
                }}
              >
                {delegationChains.map(({ key, executionAvailable: available }) => (
                  <option key={key} value={key}>
                    {SUPPORTED_CHAINS[key].name}{available ? "" : " - execution unavailable"}
                  </option>
                ))}
              </select>
            </label>
            {!executionAvailable && (
              <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                1Shot does not currently advertise Base Mainnet (8453), so Treasury Copilot will not create a delegation that cannot be executed.
              </p>
            )}
            <label className="grid gap-2 text-sm font-medium">
              Token
              <input className="field" value="USDC" disabled />
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
            disabled={!executionAvailable || !isConnected || !isAddress(effectiveAgent) || isDelegating}
            onClick={approveDelegation}
          >
            <WalletCards size={16} /> {isDelegating ? "Opening MetaMask..." : "Delegate weekly USDC"}
          </button>

          {grant && (
            <div className="mt-5 rounded-md border border-success/30 bg-success/10 p-4 text-sm text-success">
              <p className="font-semibold">Delegation ready</p>
              <p className="mt-2 text-neutral-300">MetaMask approved the weekly USDC permission for this agent.</p>
            </div>
          )}
          <div className="mt-5 flex gap-3 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <Fuel className="mt-0.5 shrink-0" size={18} />
            <p>Keep a small native ETH balance available for wallet account setup or upgrade steps. Approved payouts and relayer fees are charged through the configured USDC permission.</p>
          </div>
        </section>

        <section className="panel rounded-lg p-5">
          <h2 className="text-lg font-semibold">3. GenLayer policy</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Per-request cap {tokenSymbol}
              <input className="field" value={perTxCap} onChange={(event) => setPerTxCap(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Auto-approve limit {tokenSymbol}
              <input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
              <span className="text-xs font-normal leading-5 text-neutral-500">
                Requests at or below this amount are approved automatically after cap and whitelist checks. Larger requests go through the GenLayer policy review.
              </span>
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

          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            disabled={!grant || !isAddress(effectiveAgent) || isRegistering || Boolean(apiKey)}
            onClick={registerDelegation}
          >
            {isRegistering ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
            {isRegistering ? "Registering on GenLayer..." : apiKey ? "Registration complete" : "Register delegation"}
          </button>

          {status && <p className="mt-4 rounded-md border border-outline bg-surface-high p-3 text-sm text-neutral-200">{status}</p>}
          {setupError && (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
              <p className="font-semibold">Registration failed</p>
              <p className="mt-2 break-words text-neutral-200">{setupError}</p>
            </div>
          )}
          {setupResult && (
            <div className="mt-4 rounded-md border border-success/30 bg-success/10 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 size={16} /> Policy and delegation registered
              </div>
              <dl className="mt-3 grid gap-2 font-mono text-xs text-neutral-300">
                <div>
                  <dt className="text-neutral-500">Policy</dt>
                  <dd className="break-all">{setupResult.policy}</dd>
                </div>
                {setupResult.deployment_tx_hash && (
                  <div>
                    <dt className="text-neutral-500">Policy deployment</dt>
                    <dd className="break-all">{setupResult.deployment_tx_hash}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-neutral-500">Delegation registration</dt>
                  <dd className="break-all">{setupResult.delegation_tx_hash}</dd>
                </div>
              </dl>
            </div>
          )}
          {apiKey && (
            <div className="mt-4 rounded-md border border-purple/40 bg-purple/10 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-semibold text-purple"><KeyRound size={15} /> Agent API key</div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-ink">{apiKey}</pre>
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-purple/40 px-3 py-2 text-xs font-semibold text-purple"
                onClick={() => void navigator.clipboard.writeText(apiKey)}
              >
                <Clipboard size={14} /> Copy key
              </button>
            </div>
          )}
        </section>
      </div>
    </Shell></ProtectedOwnerPage>
  );
}
