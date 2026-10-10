import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { cctpDestinationChainIds, SUPPORTED_CHAINS } from "@treasury-copilot/shared";
import { arcSettlementEnabled } from "@/lib/executionBackend";
import { pilotStoreHealth } from "@/lib/pilotStore";

export const runtime = "nodejs";

/**
 * Arc settlement readiness.
 *
 * Reported as "disabled" rather than "missing" when the kill switch is off, so a deployment that
 * deliberately runs without Arc still reports healthy. When Arc is on, every piece the executor
 * needs must be present or the endpoint degrades: a half-configured Arc binding would otherwise
 * only surface when a real payout failed.
 */
function allowedChainIds(): string[] {
  return (process.env.ALLOWED_EVM_CHAIN_IDS ?? "").split(",").map((value) => value.trim());
}

function arcStatus(which: "arcTestnet" | "arc"): string {
  if (!arcSettlementEnabled()) return "disabled";
  const chain = SUPPORTED_CHAINS[which];
  if (!allowedChainIds().includes(String(chain.chainId))) return "not_allowlisted";

  const missing: string[] = [];
  if (!chain.vaultFactory) missing.push("vault_factory");
  if (which === "arcTestnet") {
    if (!process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL && !process.env.ARC_TESTNET_RPC_URL) missing.push("rpc");
  } else if (!process.env.NEXT_PUBLIC_ARC_RPC_URL && !process.env.ARC_RPC_URL) {
    missing.push("rpc");
  }
  if (missing.length > 0) return `missing:${missing.join("+")}`;

  // The executor key is reported separately from the rest, because its absence is a deliberate
  // state rather than a misconfiguration: Arc Mainnet ships with the contracts live so an owner
  // can deploy and fund a vault, while payout signing waits for a mainnet executor key that is
  // never inherited from testnet. Saying "missing" would degrade the whole deployment and imply
  // something was forgotten, so this names the actual situation instead.
  const keyVariable = which === "arc"
    ? "ARC_MAINNET_EXECUTOR_PRIVATE_KEY"
    : "ARC_EXECUTOR_PRIVATE_KEY";
  if (!process.env[keyVariable]) return `ready_for_funding:awaiting_${keyVariable.toLowerCase()}`;
  return "configured";
}

/**
 * Whether the GenLayer policy source ships with this deployment.
 *
 * deployTreasuryPolicy reads contracts/genlayer/TreasuryPolicy.py at runtime. When that file is
 * missing, owner setup fails with "Could not load TreasuryPolicy.py" and nothing before that point
 * reveals the problem, so it is surfaced here.
 */
async function policySourceStatus(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "contracts/genlayer/TreasuryPolicy.py"),
    path.resolve(process.cwd(), "../../contracts/genlayer/TreasuryPolicy.py"),
  ];
  for (const candidate of candidates) {
    try {
      const source = await readFile(candidate, "utf8");
      // A truncated or wrong file is as broken as a missing one, so check it declares a version.
      return /"contract_version":\s*"(\d+)"/.exec(source)?.[1]
        ? `v${/"contract_version":\s*"(\d+)"/.exec(source)?.[1]}`
        : "unversioned";
    } catch {
      continue;
    }
  }
  return "missing";
}

export async function GET() {
  const allowed = allowedChainIds();
  // Only advertise a settlement chain the deployment actually permits. Listing one it would refuse
  // tells an integrator they can bind a policy there when they cannot.
  const settlementChains = Object.values(SUPPORTED_CHAINS)
    .filter((chain) => !chain.destinationOnly && allowed.includes(String(chain.chainId)))
    .sort((a, b) => a.chainId - b.chainId);
  const mainnetAllowed = settlementChains.some(
    (chain) => !chain.cctp?.attestationApiUrl.includes("sandbox"),
  );

  const mongodb = await pilotStoreHealth();
  const policySource = await policySourceStatus();
  const arcTestnet = arcStatus("arcTestnet");
  const arcMainnet = arcStatus("arc");
  const checks = {
    application: "healthy",
    mongodb,
    genlayer: process.env.GENLAYER_RPC_URL || process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ? "configured" : "missing",
    registry: process.env.GENLAYER_REGISTRY || process.env.NEXT_PUBLIC_GENLAYER_REGISTRY ? "configured" : "missing",
    base_sepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ? "configured" : "default_chain_rpc",
    base_mainnet: allowedChainIds().includes("8453") ? "allowlisted" : "not_allowlisted",
    // The relayer is resolved per chain from the registry, so a single global URL is now an
    // override rather than the mechanism. Reported as such to avoid implying it gates anything.
    one_shot: process.env.ONE_SHOT_RELAYER_URL || process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
      ? "configured:override"
      : "configured:per_chain",
    arc_testnet: arcTestnet,
    arc_mainnet: arcMainnet,
    policy_source: policySource,
  } as const;
  const healthy = Object.values(checks).every(
    (value) => value !== "missing" && value !== "unavailable" && !value.startsWith("missing:"),
  );
  return NextResponse.json({
    status: healthy ? "healthy" : "degraded",
    // Derived rather than asserted. This used to be the literal string "testnet" next to a
    // hardcoded two-chain list, which would have kept claiming testnet-only after mainnet was
    // enabled.
    environment: mainnetAllowed ? "mixed" : "testnet",
    checked_at: new Date().toISOString(),
    settlement_chains: settlementChains.map((chain) => ({
      key: chain.key,
      chain_id: chain.chainId,
      name: chain.name,
      backend: chain.executionBackend,
      cctp_domain: chain.cctp?.domain ?? null,
      // A chain is listed because it is allowlisted; `enabled` says whether a payout could
      // actually be signed on it today, which for Arc needs the kill switch and an executor key.
      enabled: chain.executionBackend === "arc-vault"
        ? arcSettlementEnabled() && Boolean(
            process.env[chain.chainId === 5042 ? "ARC_MAINNET_EXECUTOR_PRIVATE_KEY" : "ARC_EXECUTOR_PRIVATE_KEY"],
          )
        : true,
      cctp_destinations: cctpDestinationChainIds(chain.chainId).length,
    })),
    checks,
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
