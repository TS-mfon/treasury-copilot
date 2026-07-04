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
  if (!chain.viemChain) throw new Error("Selected chain is not supported for delegation setup yet");

  const client = createClient({
    chain: chain.viemChain,
    transport: custom(window.ethereum),
  }).extend(erc7715ProviderActions());

  const [grant] = await client.requestExecutionPermissions([
    {
      chainId: chain.chainId,
      from: params.owner,
      to: params.agent,
      redeemer: [params.agent],
      payee: [params.agent],
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
