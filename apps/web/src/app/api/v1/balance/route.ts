import { formatUnits } from "viem";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertPolicyMatchesApiKey, assertRegistryBinding, amountToUnits, readPolicyState } from "@/lib/apiServer";
import { erc20Abi, chainById } from "@treasury-copilot/shared";
import { createPublicClient, http } from "viem";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const policy = await readPolicyState(claims.policy);
    assertPolicyMatchesApiKey(policy, claims);
    await assertRegistryBinding(claims);
    const chain = chainById(claims.chainId);
    if (!chain) throw new Error("Unsupported chain in API key");
    const client = createPublicClient({ chain: chain.viemChain, transport: http() });
    const balance = await client.readContract({
      address: claims.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [claims.delegatedAccount],
    }) as bigint;
    const decimals = claims.tokenDecimals ?? 6;
    return Response.json({
      owner: claims.owner,
      agent: claims.agent,
      policy: claims.policy,
      delegated_account: claims.delegatedAccount,
      chain_id: claims.chainId,
      token: claims.token,
      token_symbol: claims.tokenSymbol,
      token_decimals: decimals,
      balance: formatUnits(balance, decimals),
      balance_units: balance.toString(),
      weekly_spent: formatUnits(BigInt(policy.weekly_spent_atto ?? "0"), decimals),
      weekly_spent_units: policy.weekly_spent_atto ?? "0",
      weekly_cap: formatUnits(BigInt(policy.weekly_cap_atto ?? "0"), decimals),
      weekly_cap_units: policy.weekly_cap_atto ?? "0",
      per_tx_cap: formatUnits(BigInt(policy.per_tx_cap_atto ?? "0"), decimals),
      per_tx_cap_units: policy.per_tx_cap_atto ?? "0",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Balance request failed" }, { status: 400 });
  }
}
