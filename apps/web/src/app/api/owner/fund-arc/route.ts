import { isAddress, type Address } from "viem";
import { SUPPORTED_CHAINS } from "@treasury-copilot/shared";
import { buildArcFundingPlan, FundingUnsupportedError } from "@/lib/arcFunding";
import { apiErrorResponse } from "@/lib/errors";
import { requireOwnerSession } from "@/lib/ownerSession";

export const runtime = "nodejs";

/**
 * Plan an inbound CCTP transfer that funds an Arc treasury vault.
 *
 * The platform never touches the owner's source-chain USDC. This returns the exact approval and
 * burn calldata for the owner to sign in their own wallet, so the authority to move those funds
 * stays with the owner.
 */
export async function POST(request: Request) {
  try {
    await requireOwnerSession();
    const body = await request.json() as Record<string, unknown>;

    const vault = body.vault;
    if (typeof vault !== "string" || !isAddress(vault)) {
      throw new FundingUnsupportedError("vault", "A valid vault address is required");
    }

    const rawAmount = body.amount ?? body.amount_units;
    if (typeof rawAmount !== "string" || !/^\d+$/.test(rawAmount.trim())) {
      throw new FundingUnsupportedError("amount", "amount must be a whole number of USDC base units");
    }

    const sourceChainId = Number(body.source_chain ?? body.source_chain_id);
    const destinationChainId = Number(
      body.destination_chain ?? body.destination_chain_id ?? SUPPORTED_CHAINS.arcTestnet.chainId,
    );
    if (!Number.isInteger(sourceChainId) || sourceChainId <= 0) {
      throw new FundingUnsupportedError("source", "source_chain must be a positive chain id");
    }

    const plan = await buildArcFundingPlan({
      sourceChainId,
      destinationChainId,
      vault: vault as Address,
      amount: BigInt(rawAmount.trim()),
    });

    return Response.json({
      source_chain: { chain_id: plan.sourceChainId, name: plan.sourceChainName },
      destination_chain: { chain_id: plan.destinationChainId, name: plan.destinationChainName },
      vault: plan.vault,
      amount_units: plan.amount.toString(),
      total_amount_units: plan.totalAmount.toString(),
      max_fee_units: plan.maxFee.toString(),
      forwarded: plan.forwarded,
      min_finality_threshold: plan.minFinalityThreshold,
      transactions: plan.transactions,
      // With forwarding, Circle submits the Arc-side mint, so the owner signs only on the source.
      next_step: plan.forwarded
        ? "Sign both transactions on the source chain. Circle will mint into the vault on the destination chain."
        : "Sign both transactions on the source chain, then the platform will submit the destination mint.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FundingUnsupportedError) {
      return Response.json({
        error: "funding_unsupported",
        message: error.message,
        stage: error.stage,
        retryable: false,
      }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    return apiErrorResponse(error);
  }
}
