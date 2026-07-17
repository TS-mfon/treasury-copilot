import { type Address, type Hex } from "viem";
import {
  getSmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import {
  isValid7702Implementation,
  requestExecutionPermissions,
  type GetGrantedExecutionPermissionsResult,
} from "@metamask/smart-accounts-kit/actions";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
const MIN_METAMASK_VERSION = "13.23.0";
const DELEGATION_PREFIX = "0xef0100";

function toComparableVersion(version: string): number {
  const numeric = version
    .replace(/[^0-9.]/g, "")
    .split(".")
    .slice(0, 3)
    .map(Number);
  return (numeric[0] ?? 0) * 1_000_000 + (numeric[1] ?? 0) * 1_000 + (numeric[2] ?? 0);
}

function fail(message: string): never {
  console.error(`[erc7715] ${message}`);
  throw new Error(message);
}

function parseChainId(rawChainId: unknown): number {
  if (typeof rawChainId === "number" && Number.isFinite(rawChainId)) {
    return Math.floor(rawChainId);
  }

  if (typeof rawChainId === "bigint") {
    return Number(rawChainId);
  }

  if (typeof rawChainId === "string") {
    const normalized = rawChainId.trim().replace(/^0x/, "");
    if (normalized) {
      return parseInt(normalized, 16);
    }
  }

  return NaN;
}

function request<T = unknown>(
  provider: unknown,
  payload: { method: string; params?: readonly unknown[] },
): Promise<T> {
  if (
    typeof provider !== "object" ||
    provider === null ||
    typeof (provider as { request?: unknown }).request !== "function"
  ) {
    throw new Error("Invalid provider: request() is not available.");
  }

  return (provider as { request: (...args: readonly unknown[]) => Promise<T> }).request(payload);
}

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

type MetaMaskProvider = {
  isMetaMask?: unknown;
  providers?: readonly MetaMaskProvider[];
} & Record<string, unknown>;

async function resolveMetaMaskProvider(): Promise<MetaMaskProvider> {
  const ethereum = window.ethereum as MetaMaskProvider | undefined;
  if (!ethereum) throw new Error("MetaMask is not installed.");
  if (!ethereum.isMetaMask) throw new Error("Active wallet does not appear to be MetaMask.");

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
  const raw = await request<string>(ethereum, { method: "web3_clientVersion" });

  if (typeof raw !== "string") {
    throw new Error("MetaMask did not return a client version string.");
  }

  const fallbackVersion = raw.replace(/[^0-9.]/g, "").trim() || raw;
  const match = raw.match(/\/([0-9]+\.[0-9]+(\.[0-9]+)?)/i);
  const parsedVersion = match ? match[1].replace(/[^0-9.]/g, "").trim() : fallbackVersion;
  if (!parsedVersion) throw new Error(`Unexpected MetaMask version format: ${raw}`);

  return parsedVersion;
}

async function ensureSmartAccountUpgrade(ethereum: MetaMaskProvider, owner: Address, chainId: number) {
  const accountCode = (await request<Hex | undefined>(ethereum, {
    method: "eth_getCode",
    params: [owner, "latest"],
  })) as string | undefined;

  if (!accountCode || accountCode === "0x") {
    throw new Error(
      "MetaMask advanced permissions require the connected account to be upgraded to a MetaMask smart account. Switch to a smart account and retry.",
    );
  }

  const environment = getSmartAccountsEnvironment(chainId, "1.3.0");
  const expectedImplementation = environment.implementations.EIP7702StatelessDeleGatorImpl;
  if (!expectedImplementation) {
    throw new Error("Missing MetaMask Smart Account implementation address for this chain.");
  }

  const delegatedAddress = `0x${accountCode.slice(8).toLowerCase()}`;
  const isValidDelegation =
    delegatedAddress.length === 42 &&
    delegatedAddress.slice(0, 10).toLowerCase() === DELEGATION_PREFIX &&
    delegatedAddress.slice(-40).toLowerCase() === expectedImplementation.replace("0x", "").toLowerCase();

  if (!isValidDelegation) {
    const upgraded = await isValid7702Implementation({
      client: ethereum as never,
      accountAddress: owner,
      environment,
    }).catch(() => false);

    if (!upgraded) {
      throw new Error(
        `Connected account ${owner} has not been upgraded to a MetaMask Smart Account. ERC-7715 requests are rejected on this account.`,
      );
    }
  }
}

async function fetchSupportedExecutionPermissions(
  ethereum: MetaMaskProvider,
): Promise<ReadonlySet<string>> {
  const response = (await request<Record<string, { chainIds: number[] }>>(ethereum, {
    method: "wallet_getSupportedExecutionPermissions",
    params: [],
  })) ?? {};

  return new Set(Object.keys(response));
}

export async function requestWeeklyUsdcDelegation(params: {
  owner: Address;
  agent: Address;
  chainKey: SupportedChainKey;
  token: Address;
  weeklyAllowanceAtto: bigint;
  platformDelegate: Address;
}) {
  if (!window.ethereum) throw new Error("MetaMask is required");
  const chain = SUPPORTED_CHAINS[params.chainKey];
  if (chain.tokens.USDC?.kind !== "erc20")
    throw new Error("ERC-7715 delegation is available only for configured ERC-20 assets");

  const providers = (window.ethereum as MetaMaskProvider).providers;
  const providerArray = Array.isArray(providers) ? providers : [];
  const ethereumProvider =
    (providerArray.find((provider) => provider.isMetaMask) as MetaMaskProvider | undefined) ??
    (window.ethereum as MetaMaskProvider);

  if (!ethereumProvider) throw new Error("MetaMask provider is unavailable.");

  const provider = ethereumProvider as MetaMaskProvider;
  const declaredVersion = await getProviderVersion(provider);

  const currentChainIdRaw = await request<unknown>(provider, { method: "eth_chainId" });
  const currentChainId = parseChainId(currentChainIdRaw);

  if (!Number.isFinite(currentChainId) || currentChainId !== chain.chainId) {
    fail(
      `MetaMask is connected to chain ${
        typeof currentChainIdRaw === "number" ? currentChainIdRaw : currentChainIdRaw ?? "unknown"
      }; switch to ${chain.name} (${chain.chainId}) before requesting permissions.`,
    );
  }

  const minVersion = toComparableVersion(MIN_METAMASK_VERSION);
  const installedVersion = toComparableVersion(declaredVersion);
  if (installedVersion < minVersion) {
    fail(
      `MetaMask ${declaredVersion} is too old for ERC-20 periodic permissions. Minimum required MetaMask version is ${MIN_METAMASK_VERSION}.`,
    );
  }

  await ensureSmartAccountUpgrade(provider, params.owner, chain.chainId);

  const supportedPermissions = await fetchSupportedExecutionPermissions(provider);
  if (!supportedPermissions.has("erc20-token-periodic")) {
    fail(
      "MetaMask does not list the erc20-token-periodic permission on this chain. Update MetaMask, connect a MetaMask Smart Account, or switch to a supported network.",
    );
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = currentTime + WEEK_IN_SECONDS;

  console.debug("[erc7715] ERC-7715 request debug", {
    walletMetaMask: (window.ethereum as MetaMaskProvider).isMetaMask,
    currentChainId,
    targetChainId: chain.chainId,
    installedMetaMaskVersion: declaredVersion,
    supportedPermissions: Array.from(supportedPermissions),
  });

  const [grant] = await requestExecutionPermissions(provider as never, [
    {
      chainId: chain.chainId,
      expiry,
      to: params.platformDelegate,
      permission: {
        type: "erc20-token-periodic",
        data: {
          tokenAddress: params.token,
          periodAmount: params.weeklyAllowanceAtto,
          periodDuration: WEEK_IN_SECONDS,
          justification: "Treasury Copilot weekly agent spending delegation",
        },
        isAdjustmentAllowed: false,
      },
    },
  ]);

  if (!grant?.context || !grant.delegationManager) {
    fail("MetaMask did not return a usable delegation context");
  }

  return {
    owner: params.owner,
    agent: params.agent,
    chainId: chain.chainId,
    token: params.token,
    weeklyAllowanceAtto: params.weeklyAllowanceAtto.toString(),
    permissionContext: grant.context,
    delegationManager: grant.delegationManager,
    delegatedAccount: (grant.from ?? params.owner) as Address,
    raw: grant,
  } satisfies TreasuryDelegationGrant;
}
