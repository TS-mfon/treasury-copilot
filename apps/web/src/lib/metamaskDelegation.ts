import { createWalletClient, custom, type Address } from "viem";
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
}

type MetaMaskProvider = {
  isMetaMask?: unknown;
  providers?: readonly MetaMaskProvider[];
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
} & Record<string, unknown>;

export function resolveMetaMaskProvider(
  injectedProvider: MetaMaskProvider | undefined =
    typeof window === "undefined"
      ? undefined
      : window.ethereum as MetaMaskProvider | undefined,
): MetaMaskProvider {
  const ethereum = injectedProvider;
  if (!ethereum) throw new Error("MetaMask is not installed.");

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
}): Promise<DelegationPreflight> {
  const provider = resolveMetaMaskProvider();
  const chain = SUPPORTED_CHAINS[params.chainKey];
  const providerVersion = await getProviderVersion(provider).catch(() => "unknown");

  // Capability discovery is intentionally not a gate. MetaMask can support the
  // permission request even when wallet_getSupportedExecutionPermissions is absent.
  return { providerVersion, permissionType: "erc20-token-periodic", chainId: chain.chainId };
}

export async function requestWeeklyUsdcDelegation(params: {
  owner: Address;
  agent: Address;
  chainKey: SupportedChainKey;
  token: Address;
  weeklyAllowanceAtto: bigint;
  platformDelegate: Address;
}) {
  const ethereumProvider = resolveMetaMaskProvider();
  const chain = SUPPORTED_CHAINS[params.chainKey];
  if (chain.tokens.USDC?.kind !== "erc20") throw new Error("ERC-7715 delegation is available only for configured ERC-20 assets");
  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = currentTime + WEEK_IN_SECONDS;

  await preflightWeeklyUsdcDelegation({ owner: params.owner, chainKey: params.chainKey });
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
    if (isUnsupportedExecutionPermissionsError(rawError)) {
      throw new Error(
        `This MetaMask provider does not expose wallet_requestExecutionPermissions on ${chain.name}. Update MetaMask, enable Smart Account permissions, or use a supported MetaMask account. Details: ${reason}`,
      );
    }
    throw new Error(`ERC-7715 permission request failed: ${reason}`);
  }
}
