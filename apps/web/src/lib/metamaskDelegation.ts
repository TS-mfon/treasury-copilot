import { createPublicClient, http, toFunctionSelector, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { createBundlerClient } from "viem/account-abstraction";
import { Implementation, toMetaMaskSmartAccount, createDelegation, ScopeType } from "@metamask/smart-accounts-kit";

export async function buildTreasuryPayoutDelegationDraft(params: {
  ownerAccount: {
    address: Address;
    signMessage: unknown;
    signTypedData: unknown;
  };
  delegate: Address;
  treasury: Address;
  maxAmount: bigint;
}) {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  });
  const bundlerClient = createBundlerClient({
    client: publicClient,
    transport: http(process.env.NEXT_PUBLIC_BUNDLER_RPC_URL),
  });

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient as never,
    implementation: Implementation.Hybrid,
    deployParams: [params.ownerAccount.address, [], [], []],
    deploySalt: "0x",
    signer: { account: params.ownerAccount as never },
  });

  const delegation = createDelegation({
    to: params.delegate,
    from: smartAccount.address,
    environment: smartAccount.environment,
    scope: {
      type: ScopeType.FunctionCall,
      targets: [params.treasury],
      selectors: [toFunctionSelector("payout(bytes32,address,uint256)")],
    },
  });

  return { publicClient, bundlerClient, smartAccount, delegation };
}
