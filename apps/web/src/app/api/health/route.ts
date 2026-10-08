import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { SUPPORTED_CHAINS } from "@treasury-copilot/shared";
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
function arcStatus(): string {
  if (!arcSettlementEnabled()) return "disabled";
  const missing: string[] = [];
  if (!process.env.ARC_EXECUTOR_PRIVATE_KEY) missing.push("executor_key");
  if (!SUPPORTED_CHAINS.arcTestnet.vaultFactory) missing.push("vault_factory");
  if (!process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL && !process.env.ARC_TESTNET_RPC_URL) missing.push("rpc");
  const allowed = (process.env.ALLOWED_EVM_CHAIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim());
  if (!allowed.includes(String(SUPPORTED_CHAINS.arcTestnet.chainId))) missing.push("chain_allowlist");
  return missing.length === 0 ? "configured" : `missing:${missing.join("+")}`;
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
  const mongodb = await pilotStoreHealth();
  const policySource = await policySourceStatus();
  const arc = arcStatus();
  const checks = {
    application: "healthy",
    mongodb,
    genlayer: process.env.GENLAYER_RPC_URL || process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ? "configured" : "missing",
    registry: process.env.GENLAYER_REGISTRY || process.env.NEXT_PUBLIC_GENLAYER_REGISTRY ? "configured" : "missing",
    base_sepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ? "configured" : "default_chain_rpc",
    one_shot: process.env.ONE_SHOT_RELAYER_URL || process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL ? "configured" : "missing",
    arc_testnet: arc,
    policy_source: policySource,
  } as const;
  const healthy = Object.values(checks).every(
    (value) => value !== "missing" && value !== "unavailable" && !value.startsWith("missing:"),
  );
  return NextResponse.json({
    status: healthy ? "healthy" : "degraded",
    environment: "testnet",
    checked_at: new Date().toISOString(),
    settlement_chains: Object.values(SUPPORTED_CHAINS)
      .filter((chain) => chain.key === "baseSepolia" || chain.key === "arcTestnet")
      .map((chain) => ({
        key: chain.key,
        chain_id: chain.chainId,
        name: chain.name,
        backend: chain.executionBackend,
        cctp_domain: chain.cctp?.domain ?? null,
        enabled: chain.executionBackend === "arc-vault" ? arcSettlementEnabled() : true,
      })),
    checks,
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
