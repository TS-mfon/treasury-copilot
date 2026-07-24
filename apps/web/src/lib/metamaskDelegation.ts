import { createWalletClient, custom, numberToHex, type Address, type Hex } from "viem";
import {
  erc7715ProviderActions,
  type GetGrantedExecutionPermissionsResult,
} from "@metamask/smart-accounts-kit/actions";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";
import { errorMessage } from "@/lib/errors";

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

export interface TreasuryDelegationGrant {
  owner: Address;
  agent: Address;
  chainId: number;
  token: Address;
  weeklyAllowanceAtto: string;
  permissionContext: `0x${string}`;
  delegationManager: Address;
  delegatedAccount: Address;
  raw: GetGrantedExecutionPermissionsResult[number];
}

export interface DelegationPreflight {
  providerVersion: string;
  permissionType: "erc20-token-periodic";
  chainId: number;
  chainIdHex: Hex;
  capabilities: unknown;
}

type MetaMaskProvider = {
  isMetaMask?: unknown;
  providers?: readonly MetaMaskProvider[];
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
} & Record<string, unknown>;

export function resolveMetaMaskProvider(
  injectedProvider: unknown =
    typeof window === "undefined"
      ? undefined
      : window.ethereum,
): MetaMaskProvider {
  if (
    !injectedProvider
    || typeof injectedProvider !== "object"
    || typeof (injectedProvider as { request?: unknown }).request !== "function"
  ) {
    throw new Error("MetaMask is not installed or the connected provider is invalid.");
  }
  const ethereum = injectedProvider as MetaMaskProvider;

  if (Array.isArray(ethereum.providers)) {
    const specific = ethereum.providers.find(
      (candidate): candidate is MetaMaskProvider => candidate.isMetaMask,
    );
    if (!specific) throw new Error("MetaMask provider is required, but none was identified.");
    return specific;
  }

  return ethereum;
}

async function getProviderVersion(ethereum: MetaMaskProvider): Promise<string> {
  const raw = await ethereum.request({ method: "web3_clientVersion", params: [] });

  if (typeof raw !== "string") {
    throw new Error("MetaMask did not return a client version string.");
  }

  const fallbackVersion = raw.replace(/[^0-9.]/g, "").trim() || raw;
  const match = raw.match(/\/([0-9]+\.[0-9]+(\.[0-9]+)?)/i);
  const parsedVersion = match ? match[1].replace(/[^0-9.]/g, "").trim() : fallbackVersion;
  if (!parsedVersion) throw new Error(`Unexpected MetaMask version format: ${raw}`);

  return parsedVersion;
}

async function activeChainId(provider: MetaMaskProvider): Promise<Hex> {
  const value = await provider.request({ method: "eth_chainId", params: [] });
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`MetaMask returned an invalid eth_chainId value: ${String(value)}`);
  }
  return value.toLowerCase() as Hex;
}

export async function switchAndConfirmChain(
  provider: MetaMaskProvider,
  chainId: number,
  chainName: string,
): Promise<Hex> {
  const target = numberToHex(chainId).toLowerCase() as Hex;
  let current = await activeChainId(provider);

  if (current !== target) {
    try {
      const response = await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target }],
      });
      console.info("[ERC-7715][chain-switch] wallet_switchEthereumChain response", {
        chain: chainName,
        chainId: target,
        response,
      });
    } catch (error) {
      console.error("[ERC-7715][chain-switch] failed", {
        chain: chainName,
        chainId: target,
        error,
      });
      throw new Error(`Chain switch failed on ${chainName}: ${errorMessage(error)}`);
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      current = await activeChainId(provider);
      if (current === target) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (current !== target) {
    throw new Error(
      `Chain switch failed on ${chainName}: MetaMask remained on ${current}, expected ${target}.`,
    );
  }
  return target;
}

function permissionCapability(capabilities: unknown, chainIdHex: Hex) {
  if (!capabilities || typeof capabilities !== "object") return undefined;
  const chainCapabilities = (capabilities as Record<string, unknown>)[chainIdHex];
  if (!chainCapabilities || typeof chainCapabilities !== "object") return undefined;
  const permissions = (chainCapabilities as Record<string, unknown>).permissions;
  if (!permissions || typeof permissions !== "object") return undefined;
  const supported = (permissions as Record<string, unknown>).supported;
  return typeof supported === "boolean" ? supported : undefined;
}

async function inspectCapabilities(
  provider: MetaMaskProvider,
  owner: Address,
  chainIdHex: Hex,
  chainName: string,
) {
  try {
    const capabilities = await provider.request({
      method: "wallet_getCapabilities",
      params: [owner, [chainIdHex]],
    });
    console.info("[ERC-7715][capability-check] wallet_getCapabilities response", {
      owner,
      chain: chainName,
      chainId: chainIdHex,
      capabilities,
    });

    if (permissionCapability(capabilities, chainIdHex) === false) {
      throw new Error(
        `MetaMask reports execution permissions are unsupported on ${chainName} (${chainIdHex}).`,
      );
    }
    return capabilities;
  } catch (error) {
    console.error("[ERC-7715][capability-check] failed", {
      owner,
      chain: chainName,
      chainId: chainIdHex,
      error,
    });

    // wallet_getCapabilities does not standardize an ERC-7715 permissions
    // field. Missing support for this diagnostic RPC must not block the direct
    // Siggy-compatible wallet_requestExecutionPermissions request.
    if (isUnsupportedExecutionPermissionsError(error)) return undefined;
    throw new Error(`Capability check failed on ${chainName}: ${errorMessage(error)}`);
  }
}

export function isUnsupportedExecutionPermissionsError(error: unknown) {
  const seen = new WeakSet<object>();

  function inspect(value: unknown, depth = 0): boolean {
    if (typeof value === "string") {
      const message = value.toLowerCase();
      return message.includes("method not found")
        || message.includes("does not exist")
        || message.includes("corresponding handler")
        || message.includes("not available")
        || message.includes("unsupported method");
    }
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return false;
    seen.add(value);

    const record = value as Record<string, unknown>;
    if (record.code === -32601 || record.code === 4200) return true;
    return Object.values(record).some((nested) => inspect(nested, depth + 1));
  }

  return inspect(error);
}

export async function preflightWeeklyUsdcDelegation(params: {
  owner: Address;
  chainKey: SupportedChainKey;
  provider?: unknown;
}): Promise<DelegationPreflight> {
  const provider = resolveMetaMaskProvider(params.provider);
  const chain = SUPPORTED_CHAINS[params.chainKey];
  const chainIdHex = await switchAndConfirmChain(provider, chain.chainId, chain.name);
  const capabilities = await inspectCapabilities(provider, params.owner, chainIdHex, chain.name);
  const providerVersion = await getProviderVersion(provider).catch(() => "unknown");

  return {
    providerVersion,
    permissionType: "erc20-token-periodic",
    chainId: chain.chainId,
    chainIdHex,
    capabilities,
  };
}

export async function requestWeeklyUsdcDelegation(params: {
  owner: Address;
  agent: Address;
  chainKey: SupportedChainKey;
  token: Address;
  weeklyAllowanceAtto: bigint;
  platformDelegate: Address;
  provider?: unknown;
}) {
  const ethereumProvider = resolveMetaMaskProvider(params.provider);
  const chain = SUPPORTED_CHAINS[params.chainKey];
  if (chain.tokens.USDC?.kind !== "erc20") throw new Error("ERC-7715 delegation is available only for configured ERC-20 assets");
  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = currentTime + WEEK_IN_SECONDS;

  await preflightWeeklyUsdcDelegation({
    owner: params.owner,
    chainKey: params.chainKey,
    provider: ethereumProvider,
  });
  const walletClient = createWalletClient({
    chain: chain.viemChain,
    transport: custom(ethereumProvider),
  }).extend(erc7715ProviderActions());

  try {
    const [grant] = await walletClient.requestExecutionPermissions([
      {
        from: params.owner,
        chainId: chain.chainId,
        to: params.platformDelegate,
        expiry,
        permission: {
          type: "erc20-token-periodic",
          data: {
            tokenAddress: params.token,
            periodAmount: params.weeklyAllowanceAtto,
            periodDuration: WEEK_IN_SECONDS,
            startTime: currentTime,
            justification: "Treasury Copilot weekly agent spending delegation",
          },
          isAdjustmentAllowed: false,
        },
      },
    ]);
    console.info("[ERC-7715][permission-request] wallet response", {
      chain: chain.name,
      chainId: numberToHex(chain.chainId),
      grants: grant ? 1 : 0,
    });

    if (!grant?.context || !grant.delegationManager) {
      throw new Error("MetaMask did not return a usable delegation context");
    }

    return {
      owner: params.owner,
      agent: params.agent,
      chainId: chain.chainId,
      token: params.token,
      weeklyAllowanceAtto: params.weeklyAllowanceAtto.toString(),
      permissionContext: grant.context,
      delegationManager: grant.delegationManager,
      delegatedAccount: (grant.from as Address) ?? params.owner,
      raw: grant,
    } satisfies TreasuryDelegationGrant;
  } catch (rawError) {
    const reason = errorMessage(rawError);
    console.error("[ERC-7715][permission-request] failed", {
      chain: chain.name,
      chainId: numberToHex(chain.chainId),
      error: rawError,
    });
    if (isUnsupportedExecutionPermissionsError(rawError)) {
      throw new Error(
        `This MetaMask provider does not expose wallet_requestExecutionPermissions on ${chain.name}. Update MetaMask, enable Smart Account permissions, or use a supported MetaMask account. Details: ${reason}`,
      );
    }
    throw new Error(`Permission request failed on ${chain.name}: ${reason}`);
  }
}
