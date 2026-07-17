import { createClient, custom, type Address, type Hex } from "viem";
import { erc7715ProviderActions, type GetGrantedExecutionPermissionsResult } from "@metamask/smart-accounts-kit/actions";
import { SUPPORTED_CHAINS, type SupportedChainKey } from "@treasury-copilot/shared";

export interface TreasuryDelegationGrant {
  owner: Address;
  agent: Address;
  chainId: number;
  token: Address;
  weeklyAllowanceAtto: string;
  permissionContext: Hex;
  delegationManager: Address;
  delegatedAccount: Address;
  raw: GetGrantedExecutionPermissionsResult[number];
}

export async function requestWeeklyUsdcDelegation(params: {
  owner: Address;
  agent: Address;
  chainKey: SupportedChainKey;
  token: Address;
  weeklyAllowanceAtto: bigint;
}) {
  if (!window.ethereum) throw new Error("MetaMask is required");
  const chain = SUPPORTED_CHAINS[params.chainKey];
  if (chain.tokens.USDC?.kind !== "erc20") throw new Error("ERC-7715 delegation is available only for configured ERC-20 assets");

  // Wallets that do not implement ERC-7715 used to fail only after the user
  // clicked through the permission UI. Probe capabilities first and turn that
  // provider mismatch into an actionable setup state.
  try {
    const capabilities = await window.ethereum.request({
      method: "wallet_getCapabilities",
      params: [params.owner, `0x${chain.chainId.toString(16)}`],
    }) as Record<string, unknown> | undefined;
    const hasCapability = !!(
      capabilities &&
      (("wallet_requestExecutionPermissions" in capabilities) ||
        ("requestExecutionPermissions" in capabilities))
    );
    if (!hasCapability) {
      console.warn("[erc7715] wallet_getCapabilities did not list execution-permission support; attempting the wallet call anyway");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[erc7715] capability preflight failed:", message);
    // Some EIP-1193 providers do not expose capability discovery. Continue
    // to the actual wallet call so the user can still approve the permission.
  }

  const client = createClient({
    chain: chain.viemChain,
    transport: custom(window.ethereum),
  }).extend(erc7715ProviderActions());

  const [grant] = await client.requestExecutionPermissions([
    {
      chainId: chain.chainId,
      from: params.owner,
      to: params.agent,
      permission: {
        type: "erc20-token-periodic",
        isAdjustmentAllowed: false,
        data: {
          tokenAddress: params.token,
          periodAmount: params.weeklyAllowanceAtto,
          periodDuration: 7 * 24 * 60 * 60,
          justification: "Treasury Copilot weekly agent spending delegation",
        },
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
    delegatedAccount: (grant.from ?? params.owner) as Address,
    raw: grant,
  } satisfies TreasuryDelegationGrant;
}
