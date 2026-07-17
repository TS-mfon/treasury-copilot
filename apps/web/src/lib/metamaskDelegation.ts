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

function request<T = unknown>(
  provider: unknown,
  payload: { method: string; params?: readonly unknown[] },
): Promise<T> {
  if (
    typeof provider !== "object" ||
    provider === null ||
    typeof (provider as { request?: (...args: readonly unknown[]) => Promise<T> }).request !== "function"
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
  request<T = unknown>(args: { method: string; params?: readonly unknown[] }): Promise<T>;
} & Record<string, unknown>;

async function resolveMetaMaskProvider(): Promise<MetaMaskProvider> {
  const ethereum = window.ethereum as MetaMaskProvider | undefined;
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
  const raw = await request<string>(ethereum, { method: "web3_clientVersion", params: [] });

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
  const accountCode = (await request<string>(ethereum, { method: "eth_getCode", params: [owner, "latest"] })) as string | undefined;
  if (!accountCode || accountCode === "0x") {
    throw new Error("MetaMask advanced permissions require the connected account to be upgraded to a MetaMask smart account. Switch to a smart account and retry.");
  }

  const environment = getSmartAccountsEnvironment(chainId, "1.3.0");
  const expectedImplementation = environment.implementations.EIP7702StatelessDeleGatorImpl;
  if (!expectedImplementation) throw new Error("Missing MetaMask Smart Account implementation address for this chain.");

  const delegatedAddress = `0x${accountCode.slice(8).toLowerCase()}`;
  const isValidDelegation =
    delegatedAddress.length === 42 &&
    delegatedAddress.slice(0, 10).toLowerCase() === DELEGATION_PREFIX &&
    delegatedAddress.slice(-40).toLowerCase() === expectedImplementation.replace("0x", "").toLowerCase();

  if (!isValidDelegation) {
    const upgraded = await isValid7702Implementation({ client: ethereum as never, accountAddress: owner, environment }).catch(() => false);
    if (!upgraded) {
      throw new Error(`Connected account ${owner} has not been upgraded to a MetaMask Smart Account. ERC-7715 requests are rejected on this account.`);
    }
  }
}

export async function requestWeeklyUsdcDelegation(params: {
  owner: Address;
  agent: Address;
  chainKey: SupportedChainKey;
  token: Address;
  weeklyAllowanceAtto: bigint;
  platformDelegate: Address;
}) {
  const ethereumProvider = await resolveMetaMaskProvider();
  const chain = SUPPORTED_CHAINS[params.chainKey];
  if (chain.tokens.USDC?.kind !== "erc20") throw new Error("ERC-7715 delegation is available only for configured ERC-20 assets");
  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = currentTime + WEEK_IN_SECONDS;

  console.debug("[erc7715] ERC-7715 request debug", {
    targetChainId: chain.chainId,
    installedMetaMaskVersion: await getProviderVersion(ethereumProvider).catch(() => "unknown"),
  });

  const [grant] = (await requestExecutionPermissions(ethereumProvider as never, [
    {
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
  ]));

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
}
