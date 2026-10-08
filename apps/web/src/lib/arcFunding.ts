import { chainById } from "@treasury-copilot/shared";
import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import {
  FINALITY_FAST,
  FORWARDING_HOOK_DATA,
  quoteFee,
  resolveRoute,
  toBytes32,
  CctpUnsupportedError,
} from "@/lib/cctp";

/**
 * Inbound CCTP: fund an Arc treasury vault from any supported chain.
 *
 * The owner holds the source-chain USDC, so the platform cannot and should not move it. This
 * builds the exact two transactions the owner signs in their own wallet — an ERC-20 approval and
 * a `depositForBurn` whose `mintRecipient` is the vault — and returns them for the UI to submit.
 * Circle's Forwarding Service performs the Arc-side mint, so no Arc gas is required from the owner.
 */

// The shared erc20Abi has no `approve`, and the owner must grant the messenger an allowance.
const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

const tokenMessengerAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

export interface FundingPlanRequest {
  sourceChainId: number;
  destinationChainId: number;
  vault: Address;
  /** Amount the vault should receive, in USDC base units. */
  amount: bigint;
}

export interface PlannedTransaction {
  to: Address;
  data: Hex;
  value: "0x0";
  description: string;
}

export interface FundingPlan {
  sourceChainId: number;
  destinationChainId: number;
  sourceChainName: string;
  destinationChainName: string;
  vault: Address;
  /** What the owner is burning: the amount to deliver plus the CCTP fee. */
  totalAmount: bigint;
  amount: bigint;
  maxFee: bigint;
  forwarded: boolean;
  minFinalityThreshold: number;
  transactions: PlannedTransaction[];
}

export class FundingUnsupportedError extends Error {
  constructor(public readonly stage: string, message: string) {
    super(message);
    this.name = "FundingUnsupportedError";
  }
}

export async function buildArcFundingPlan(
  request: FundingPlanRequest,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<FundingPlan> {
  if (!isAddress(request.vault)) {
    throw new FundingUnsupportedError("vault", "Vault address is invalid");
  }
  if (request.amount <= 0n) {
    throw new FundingUnsupportedError("amount", "Funding amount must be greater than zero");
  }

  const source = chainById(request.sourceChainId);
  const destination = chainById(request.destinationChainId);
  if (!source) throw new FundingUnsupportedError("source", `Unsupported source chain ${request.sourceChainId}`);
  if (!destination) {
    throw new FundingUnsupportedError("destination", `Unsupported destination chain ${request.destinationChainId}`);
  }
  // Only a vault-settled chain can be funded this way; a delegation chain has no vault to credit.
  if (destination.executionBackend !== "arc-vault") {
    throw new FundingUnsupportedError(
      "destination",
      `${destination.name} does not use a treasury vault, so it cannot be funded over CCTP`,
    );
  }

  const sourceUsdc = source.tokens.USDC?.address;
  if (!sourceUsdc) {
    throw new FundingUnsupportedError("token", `USDC is not configured for ${source.name}`);
  }

  let route;
  let quote;
  try {
    route = resolveRoute(request.sourceChainId, request.destinationChainId);
    quote = await quoteFee(route, { forwarded: true, finalityThreshold: FINALITY_FAST, fetchImpl: options.fetchImpl });
  } catch (error) {
    if (error instanceof CctpUnsupportedError) {
      throw new FundingUnsupportedError(error.stage, error.message);
    }
    throw error;
  }

  // CCTP deducts its fee from the burned amount, so burning amount + maxFee delivers `amount`.
  const totalAmount = request.amount + quote.maxFee;

  const approval: PlannedTransaction = {
    to: sourceUsdc,
    data: encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [route.tokenMessenger, totalAmount],
    }),
    value: "0x0",
    description: `Approve ${route.tokenMessenger} to burn ${totalAmount} USDC base units on ${source.name}`,
  };

  const burn: PlannedTransaction = {
    to: route.tokenMessenger,
    data: encodeFunctionData({
      abi: tokenMessengerAbi,
      functionName: quote.forwarded ? "depositForBurnWithHook" : "depositForBurn",
      args: quote.forwarded
        ? [
            totalAmount,
            route.destinationDomain,
            toBytes32(request.vault),
            sourceUsdc,
            toBytes32("0x0000000000000000000000000000000000000000"),
            quote.maxFee,
            quote.minFinalityThreshold,
            FORWARDING_HOOK_DATA,
          ]
        : [
            totalAmount,
            route.destinationDomain,
            toBytes32(request.vault),
            sourceUsdc,
            toBytes32("0x0000000000000000000000000000000000000000"),
            quote.maxFee,
            quote.minFinalityThreshold,
          ],
    }),
    value: "0x0",
    description: `Burn ${totalAmount} USDC on ${source.name} for delivery of ${request.amount} to the vault on ${destination.name}`,
  };

  return {
    sourceChainId: request.sourceChainId,
    destinationChainId: request.destinationChainId,
    sourceChainName: source.name,
    destinationChainName: destination.name,
    vault: request.vault,
    totalAmount,
    amount: request.amount,
    maxFee: quote.maxFee,
    forwarded: quote.forwarded,
    minFinalityThreshold: quote.minFinalityThreshold,
    transactions: [approval, burn],
  };
}
