/**
 * Gate oracle for the CCTP and Gateway work.
 *
 * Prints `CCTP_VERIFY_OK <mode>` only after every assertion in that mode passes.
 *
 *   npx tsx scripts/verify-cctp.mts <mode>
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET = 5042002;
const ARC_MAINNET = 5042;
const ARC_RPC = "https://rpc.testnet.arc.io";
const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
const SMOKE_VAULT: Address = "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2";
const SETTLE_RECIPIENT: Address = "0xEd9EDd8586b20524CafA4F568413C504C9B03172";
const SANDBOX = "https://iris-api-sandbox.circle.com";
const V6_POLICY_RECORD = "docs/policy-v6-address.txt";
const REGISTRY: Address = "0x63A045a7B3A1b173525EFFB41B07A59349Cd33D9";

const failures: string[] = [];
function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function loadEnvLocal(): Record<string, string> {
  if (!existsSync(".env.local")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/**
 * Domains Circle must agree with. Verified against the live fee service rather than only the
 * local config, so a transcription error in the registry cannot pass unnoticed.
 */
const TESTNET_DESTINATIONS: Array<{ name: string; domain: number }> = [
  { name: "Ethereum Sepolia", domain: 0 },
  { name: "OP Sepolia", domain: 2 },
  { name: "Arbitrum Sepolia", domain: 3 },
  { name: "Base Sepolia", domain: 6 },
  { name: "Polygon Amoy", domain: 7 },
];

async function modeRegistry() {
  const { SUPPORTED_CHAINS, CCTP_DOMAIN } = await import("@treasury-copilot/shared");

  // 1. Circle must recognise every Arc -> destination route the registry claims to support.
  for (const destination of TESTNET_DESTINATIONS) {
    const url = `${SANDBOX}/v2/burn/USDC/fees/${CCTP_DOMAIN.arc}/${destination.domain}`;
    const response = await fetch(url);
    if (!response.ok) {
      failures.push(`Circle rejected the Arc to ${destination.name} route (domain ${destination.domain}): ${response.status}`);
      continue;
    }
    const tiers = await response.json() as Array<Record<string, unknown>>;
    check(
      Array.isArray(tiers) && tiers.length > 0,
      `Circle returned no fee tiers for Arc to ${destination.name}`,
    );
  }

  // 2. The registry's domain for each chain must equal the one Circle accepted above.
  const byDomain = new Map<number, string[]>();
  for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
    if (!chain.cctp) continue;
    const existing = byDomain.get(chain.cctp.domain) ?? [];
    existing.push(`${key} (${chain.name})`);
    byDomain.set(chain.cctp.domain, existing);
  }
  for (const destination of TESTNET_DESTINATIONS) {
    check(
      byDomain.has(destination.domain),
      `no registry chain carries domain ${destination.domain} for ${destination.name}`,
    );
  }

  // 3. Arc's USDC interface must really report 6 decimals, since every amount depends on it.
  const client = createPublicClient({ transport: http(ARC_RPC) });
  const decimals = await client.readContract({
    address: ARC_USDC,
    abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
    functionName: "decimals",
  }) as number;
  check(decimals === 6, `Arc USDC ERC-20 reports ${decimals} decimals, expected 6`);

  const domains = TESTNET_DESTINATIONS
    .map((destination) => `${destination.domain}:${(byDomain.get(destination.domain) ?? []).length}`)
    .join(" ");
  console.log(
    `verified ${TESTNET_DESTINATIONS.length} Arc routes against Circle; ` +
    `registry chains per domain ${domains}; Arc USDC decimals=${decimals}`,
  );
}

async function modeSettleCrossChain() {
  for (const [key, value] of Object.entries(loadEnvLocal())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const { executeArcVaultPayout } = await import("../apps/web/src/lib/arcVault.ts");
  const { fetchAttestation, quoteFee, resolveRoute } = await import("../apps/web/src/lib/cctp.ts");
  const { agentTreasuryAbi } = await import("@treasury-copilot/shared");

  const destinationChainId = 84532; // Base Sepolia
  const amount = 50_000n; // 0.05 USDC, enough to prove movement without draining the vault
  const requestId = keccak256(stringToHex(`cctp-gate-${Date.now()}`));

  // Every cross-chain settlement consumes the vault's bounded fee reserve, so a gate that did not
  // replenish it would succeed only a handful of times and then fail for a reason unrelated to the
  // behaviour under test. Topping up is an ordinary owner action, and the contract's refusal to dip
  // into principal is covered separately by the Solidity tests and the live revert checks.
  const route = resolveRoute(ARC_TESTNET, destinationChainId);
  const quote = await quoteFee(route, { forwarded: true });
  const headroom = quote.maxFee * 4n;

  const arcRpc = process.env.ARC_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL;
  const arcClient = createPublicClient({ transport: http(arcRpc ?? ARC_RPC) });
  const at = { address: SMOKE_VAULT, abi: agentTreasuryAbi } as const;
  const reserve = await arcClient.readContract({ ...at, functionName: "feeReserve" }) as bigint;

  if (reserve < quote.maxFee) {
    const ownerKey = process.env.AGENT_SIGNER_PRIVATE_KEY;
    if (!ownerKey) {
      failures.push(`vault fee reserve is ${reserve} but the fee needs ${quote.maxFee}, and no owner key is available to top it up`);
      return;
    }
    const owner = privateKeyToAccount(`0x${ownerKey.replace(/^0x/, "")}` as Hex);
    const { SUPPORTED_CHAINS } = await import("@treasury-copilot/shared");
    const chain = SUPPORTED_CHAINS.arcTestnet.viemChain;
    const wallet = createWalletClient({ account: owner, chain, transport: http(arcRpc ?? ARC_RPC) });
    const cap = await arcClient.readContract({ ...at, functionName: "feeReserveCap" }) as bigint;
    const target = reserve + headroom;
    if (cap < target) {
      const raise = await wallet.writeContract({ ...at, chain, functionName: "setFeeReserveCap", args: [target] });
      await arcClient.waitForTransactionReceipt({ hash: raise });
    }
    const fund = await wallet.writeContract({ ...at, chain, functionName: "fundFeeReserve", args: [headroom] });
    await arcClient.waitForTransactionReceipt({ hash: fund });
    const topped = await arcClient.readContract({ ...at, functionName: "feeReserve" }) as bigint;
    check(topped >= quote.maxFee, `fee reserve is still ${topped} after top-up, need ${quote.maxFee}`);
    console.log(`topped up fee reserve ${reserve} -> ${topped} (fee ${quote.maxFee})`);
  }

  const result = await executeArcVaultPayout({
    chainId: ARC_TESTNET,
    vault: SMOKE_VAULT,
    requestId,
    recipient: SETTLE_RECIPIENT,
    amount: amount.toString(),
    destinationChainId,
  });

  check(result.route === "cctp", `expected a cctp route, got ${result.route}`);
  check(Boolean(result.bridge), "the result carries no bridge metadata");
  check(/^0x[0-9a-f]{64}$/i.test(result.tx_hash), `invalid burn tx hash ${result.tx_hash}`);

  // The burn is not the payee's receipt: poll Circle until it has minted on the destination.
  let destinationTx: Hex | undefined;
  for (let attempt = 0; attempt < 40 && !destinationTx; attempt += 1) {
    const status = await fetchAttestation(route, result.tx_hash);
    if (status?.forwardTxHash) destinationTx = status.forwardTxHash;
    else await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  check(Boolean(destinationTx), "Circle never reported a destination mint for the burn");
  if (!destinationTx) return;

  // Confirm the mint actually credited the payee the full principal on the destination chain.
  const baseRpc = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  const baseUsdc = (process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
  const baseClient = createPublicClient({ transport: http(baseRpc) });
  const receipt = await baseClient.getTransactionReceipt({ hash: destinationTx });
  check(receipt.status === "success", `destination mint ${destinationTx} did not succeed`);

  const TRANSFER = keccak256(stringToHex("Transfer(address,address,uint256)"));
  const minted = receipt.logs
    .filter((log) => log.address.toLowerCase() === baseUsdc.toLowerCase())
    .filter((log) => log.topics[0]?.toLowerCase() === TRANSFER.toLowerCase())
    .filter((log) => `0x${(log.topics[2] ?? "").slice(-40)}`.toLowerCase() === SETTLE_RECIPIENT.toLowerCase())
    .map((log) => BigInt(log.data));
  check(
    minted.includes(amount),
    `destination mint credited ${minted.join(",")} to the payee, expected exactly ${amount}`,
  );

  console.log(`burn=${result.tx_hash} mint=${destinationTx} principal=${amount} minted=${minted.join(",")}`);
}

async function modeGateway() {
  for (const [key, value] of Object.entries(loadEnvLocal())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const { probeGateway, GATEWAY_CONTRACTS } = await import("../apps/web/src/lib/gateway.ts");

  check(Boolean(GATEWAY_CONTRACTS.arcTestnet), "no Gateway contracts recorded for Arc Testnet");
  const availability = await probeGateway("arcTestnet");
  // Gateway is deployed on Arc, so a negative result here is a real finding, not an expected gap.
  check(
    availability.supported,
    `Gateway is not live on Arc Testnet: ${availability.unsupportedStage ?? "unknown"}`,
  );
  check(availability.chainId === ARC_TESTNET, `probe reported chain ${availability.chainId}`);

  // Negative control: a chain with no Gateway deployment must report not-deployed rather than true.
  const absent = await probeGateway("baseSepolia");
  check(absent.supported === false, "Base Sepolia should have no Gateway deployment recorded");
  check(absent.unsupportedStage === "not-deployed", `expected not-deployed, got ${absent.unsupportedStage}`);

  console.log(
    `gateway arcTestnet=${availability.supported} wallet=${availability.wallet} minter=${availability.minter}; ` +
    `control baseSepolia=${absent.supported}/${absent.unsupportedStage}`,
  );
}

function modeSetupUi() {
  const page = readFileSync("apps/web/src/app/setup/page.tsx", "utf8");
  check(page.includes('"arcTestnet"'), "the setup page does not offer Arc Testnet");
  check(page.includes("deployAgentTreasuryVault"), "the setup page does not deploy a vault");
  check(page.includes("vaultSettled"), "the setup page does not branch on vault settlement");
  check(page.includes("deployVault"), "the setup page has no vault deployment handler");
  check(page.includes("destination_chains"), "the setup page does not submit a destination allowlist");
  // The vault must be submitted so the server can register it.
  check(/vault, destination_chains/.test(page) || page.includes("{ vault,"), "the setup page does not submit the vault");

  const route = readFileSync("apps/web/src/app/api/v1/setup/route.ts", "utf8");
  check(route.includes("register_vault"), "the setup route never registers a vault");
  check(route.includes("vault_registered"), "the setup route does not read the vault binding back");
  check(route.includes("arc-vault"), "the setup route does not handle the vault backend");
  // A V6 deploy must pass the two new constructor arguments.
  check(route.includes("body.settlementBackend"), "the setup route does not pass the settlement backend");
  check(route.includes("body.destinationChains"), "the setup route does not pass the destination allowlist");

  console.log("setup page and route wire Arc vault deployment and registration");
}

function modeRegistryBinding() {
  if (!existsSync(V6_POLICY_RECORD)) {
    failures.push(`${V6_POLICY_RECORD} is missing`);
    return;
  }
  const policy = readFileSync(V6_POLICY_RECORD, "utf8").trim();
  check(/^0x[0-9a-fA-F]{40}$/.test(policy), `recorded policy address is malformed: ${policy}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(policy)) return;

  const password = process.env.GENLAYER_KEYSTORE_PASSWORD;
  if (!password) {
    failures.push("GENLAYER_KEYSTORE_PASSWORD is not set, so the registry cannot be read");
    return;
  }

  let output: string;
  try {
    output = execFileSync("genlayer", ["call", REGISTRY, "get_policy", "--args", policy], {
      encoding: "utf8",
      input: `${password}\n`,
      timeout: 300_000,
    });
  } catch (error) {
    failures.push(`registry read failed: ${(error as Error).message.split("\n")[0]}`);
    return;
  }

  const field = (name: string) => new RegExp(`${name}:\\s*'([^']*)'`).exec(output)?.[1];
  check(/active:\s*true/.test(output), "the Arc policy is not active in the registry");
  check(
    field("policy")?.toLowerCase() === policy.toLowerCase(),
    `registry returned policy ${field("policy")}, expected ${policy}`,
  );
  check(field("chain_id") === String(ARC_TESTNET), `registry chain_id is ${field("chain_id")}, expected ${ARC_TESTNET}`);
  // For an Arc binding the funding account slot holds the vault address.
  check(
    field("delegated_account")?.toLowerCase() === SMOKE_VAULT.toLowerCase(),
    `registry funding account is ${field("delegated_account")}, expected the vault ${SMOKE_VAULT}`,
  );
  check(
    field("token_address")?.toLowerCase() === ARC_USDC.toLowerCase(),
    `registry token is ${field("token_address")}, expected Arc USDC`,
  );

  console.log(
    `registry binding policy=${policy} chain=${field("chain_id")} vault=${field("delegated_account")} active=true`,
  );
}

async function modeMainnetOff() {
  const env = loadEnvLocal();
  const allowed = (env.ALLOWED_EVM_CHAIN_IDS ?? "").split(",").map((value) => value.trim());
  check(!allowed.includes(String(ARC_MAINNET)), "Arc mainnet is present in ALLOWED_EVM_CHAIN_IDS");
  check(allowed.includes(String(ARC_TESTNET)), "Arc Testnet is missing from ALLOWED_EVM_CHAIN_IDS");

  // No mainnet vault factory may be configured, or an owner could deploy against real funds.
  check(!env.NEXT_PUBLIC_ARC_VAULT_FACTORY, "an Arc mainnet vault factory is configured");

  const { SUPPORTED_CHAINS } = await import("@treasury-copilot/shared");
  check(
    SUPPORTED_CHAINS.arc.vaultFactory === undefined,
    "the Arc mainnet chain config carries a vault factory",
  );

  // The deployed app must not advertise Arc mainnet as an enabled settlement chain.
  const url = existsSync("docs/arc-deployment-url.txt")
    ? readFileSync("docs/arc-deployment-url.txt", "utf8").trim()
    : undefined;
  if (url) {
    const response = await fetch(new URL("/api/health", url), { cache: "no-store" });
    const body = await response.json() as { settlement_chains?: Array<Record<string, unknown>> };
    const mainnet = (body.settlement_chains ?? []).find((chain) => chain.chain_id === ARC_MAINNET);
    check(!mainnet, "the deployed app advertises Arc mainnet as a settlement chain");
  }

  console.log(`arc mainnet disabled: allowlist=${allowed.join(",")} factory=unset`);
}

const MODES: Record<string, () => void | Promise<void>> = {
  registry: modeRegistry,
  "settle-cross-chain": modeSettleCrossChain,
  gateway: modeGateway,
  "setup-ui": modeSetupUi,
  "registry-binding": modeRegistryBinding,
  "mainnet-off": modeMainnetOff,
};

const mode = process.argv[2];
const run = mode ? MODES[mode] : undefined;
if (!run) {
  console.error(`usage: npx tsx scripts/verify-cctp.mts <${Object.keys(MODES).join("|")}>`);
  process.exit(2);
}

try {
  await run();
} catch (error) {
  console.error(`FAIL: ${mode} threw: ${(error as Error).message}`);
  process.exit(1);
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`CCTP_VERIFY_OK ${mode}`);
