import type { Address, Hex } from "viem";
import { chainById, type ChainConfig } from "@treasury-copilot/shared";

/**
 * Circle CCTP V2 integration.
 *
 * Treasury Copilot prefers the Forwarding Service for outbound payments. Paying to an arbitrary
 * agent-specified chain with the direct-mint strategy would require the platform to hold an
 * executor key and a gas balance on every chain it can pay to; with forwarding, Circle performs
 * the destination mint and the platform needs neither.
 *
 * Every function here fails closed and names the stage that is unsupported, rather than falling
 * back silently to a route that cannot complete.
 */

/** `bytes32` of the ASCII string "cctp-forward", the Forwarding Service marker. */
export const FORWARDING_HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as Hex;

/** CCTP V2 finality thresholds. 1000 is fast, 2000 is standard. */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;

export interface CctpRoute {
  sourceChainId: number;
  destinationChainId: number;
  sourceDomain: number;
  destinationDomain: number;
  attestationApiUrl: string;
  tokenMessenger: Address;
  messageTransmitter: Address;
}

export interface CctpFeeQuote {
  /** Upper bound to pass as `maxFee`, covering the protocol fee plus any forwarding fee. */
  maxFee: bigint;
  minFinalityThreshold: number;
  protocolFee: bigint;
  forwardFee: bigint;
  forwarded: boolean;
}

export class CctpUnsupportedError extends Error {
  constructor(public readonly stage: string, message: string) {
    super(message);
    this.name = "CctpUnsupportedError";
  }
}

function requireCctpChain(chainId: number, stage: string): ChainConfig {
  const chain = chainById(chainId);
  if (!chain) throw new CctpUnsupportedError(stage, `Unsupported chain id ${chainId}`);
  if (!chain.cctp) {
    throw new CctpUnsupportedError(stage, `CCTP does not support ${chain.name}`);
  }
  return chain;
}

/**
 * Resolve a CCTP route, refusing anything that cannot complete.
 *
 * A route whose endpoints sit on different Circle environments (sandbox vs production) is refused
 * explicitly, because the attestation service would never produce a message for it.
 */
export function resolveRoute(sourceChainId: number, destinationChainId: number): CctpRoute {
  const source = requireCctpChain(sourceChainId, "source");
  const destination = requireCctpChain(destinationChainId, "destination");

  if (source.cctp!.attestationApiUrl !== destination.cctp!.attestationApiUrl) {
    throw new CctpUnsupportedError(
      "environment",
      `Cannot bridge between ${source.name} and ${destination.name}: different Circle environments`,
    );
  }
  if (source.cctp!.domain === destination.cctp!.domain) {
    throw new CctpUnsupportedError(
      "route",
      `${source.name} and ${destination.name} share CCTP domain ${source.cctp!.domain}; no bridge is needed`,
    );
  }

  return {
    sourceChainId,
    destinationChainId,
    sourceDomain: source.cctp!.domain,
    destinationDomain: destination.cctp!.domain,
    attestationApiUrl: source.cctp!.attestationApiUrl,
    tokenMessenger: source.cctp!.tokenMessenger,
    messageTransmitter: destination.cctp!.messageTransmitter,
  };
}

interface IrisFeeEntry {
  finalityThreshold?: number;
  minimumFee?: number;
  forwardFee?: { low?: number; med?: number; high?: number };
}

/**
 * Quote `maxFee` from Circle's live fee endpoint.
 *
 * The quote is deliberately not hardcoded: CCTP fees move, and an underquoted `maxFee` produces a
 * burn whose destination mint never settles. The highest published forwarding tier is used so a
 * fee that rises between quote and burn does not strand the transfer.
 */
export async function quoteFee(
  route: CctpRoute,
  options: { forwarded?: boolean; finalityThreshold?: number; fetchImpl?: typeof fetch } = {},
): Promise<CctpFeeQuote> {
  const forwarded = options.forwarded ?? true;
  const wanted = options.finalityThreshold ?? FINALITY_FAST;
  const doFetch = options.fetchImpl ?? fetch;

  const url = new URL(
    `/v2/burn/USDC/fees/${route.sourceDomain}/${route.destinationDomain}`,
    route.attestationApiUrl,
  );
  if (forwarded) url.searchParams.set("forward", "true");

  const response = await doFetch(url, { method: "GET", headers: { "content-type": "application/json" } });
  if (!response.ok) {
    throw new CctpUnsupportedError("fee", `Circle fee lookup failed with ${response.status}`);
  }
  const entries = await response.json() as IrisFeeEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new CctpUnsupportedError("fee", "Circle returned no fee tiers for this route");
  }

  const entry = entries.find((item) => item.finalityThreshold === wanted) ?? entries[0];
  const protocolFee = BigInt(entry.minimumFee ?? 0);
  const forwardFee = forwarded
    ? BigInt(entry.forwardFee?.high ?? entry.forwardFee?.med ?? entry.forwardFee?.low ?? 0)
    : 0n;

  if (forwarded && forwardFee === 0n) {
    // Forwarding was requested but Circle quoted no forwarding fee, which means the route does not
    // support it. Surface that rather than burning with hook data Circle will not act on.
    throw new CctpUnsupportedError(
      "forwarding",
      `Circle does not offer forwarding for domain ${route.sourceDomain} to ${route.destinationDomain}`,
    );
  }

  return {
    maxFee: protocolFee + forwardFee,
    minFinalityThreshold: entry.finalityThreshold ?? wanted,
    protocolFee,
    forwardFee,
    forwarded,
  };
}

export interface AttestationStatus {
  status: string;
  /** Present once Circle has attested the burn. */
  attestation?: Hex;
  message?: Hex;
  /** Present once the Forwarding Service has minted on the destination chain. */
  forwardTxHash?: Hex;
  complete: boolean;
}

/** Read Circle's view of a burn. A 404 means not yet indexed, which is normal immediately after. */
export async function fetchAttestation(
  route: CctpRoute,
  burnTxHash: Hex,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AttestationStatus | undefined> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(
    `/v2/messages/${route.sourceDomain}?transactionHash=${burnTxHash}`,
    route.attestationApiUrl,
  );
  const response = await doFetch(url, { method: "GET" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new CctpUnsupportedError("attestation", `Circle attestation lookup failed with ${response.status}`);
  }
  const payload = await response.json() as { messages?: Array<Record<string, unknown>> };
  const message = payload.messages?.[0];
  if (!message) return undefined;

  const attestation = typeof message.attestation === "string" && message.attestation.startsWith("0x")
    ? message.attestation as Hex
    : undefined;
  const forwardTxHash = typeof message.forwardTxHash === "string" && message.forwardTxHash.startsWith("0x")
    ? message.forwardTxHash as Hex
    : undefined;
  const status = String(message.status ?? "pending");

  return {
    status,
    attestation,
    message: typeof message.message === "string" ? message.message as Hex : undefined,
    forwardTxHash,
    // A forwarded transfer is done when Circle has minted. A direct transfer is done when the
    // attestation exists, because the platform still has to submit receiveMessage itself.
    complete: Boolean(forwardTxHash) || (status === "complete" && Boolean(attestation)),
  };
}

/** Left-pad an address into the `bytes32` form CCTP expects for recipients and callers. */
export function toBytes32(address: Address): Hex {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}
