/**
 * Gate oracle for the Arc settlement wiring.
 *
 * Each mode prints `ARC_VERIFY_OK <mode>` only after every assertion in that mode passes, and
 * exits non-zero otherwise. Run with tsx so the `settle` mode can exercise the application's
 * real server-side executor rather than a reimplementation of it.
 *
 *   npx tsx scripts/verify-arc.mts <mode>
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPublicClient, http, keccak256, stringToHex, type Address, type Hex } from "viem";

const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.io";
const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
const ARC_TOKEN_MESSENGER: Address = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const EXPECTED_FACTORY: Address = "0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB";
const EXPECTED_IMPLEMENTATION: Address = "0x4eD45045c4e737287cA75d2d2980DE44a6915eeE";
const SMOKE_VAULT: Address = "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2";
const SETTLE_RECIPIENT: Address = "0xEd9EDd8586b20524CafA4F568413C504C9B03172";
const SETTLE_AMOUNT = 10_000n; // 0.01 USDC, enough to prove movement without draining the vault

const failures: string[] = [];

function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function loadEnvLocal(): Record<string, string> {
  const path = ".env.local";
  if (!existsSync(path)) throw new Error(".env.local is missing");
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function arcClient() {
  return createPublicClient({ transport: http(ARC_RPC) });
}

async function readAddress(address: Address, signature: string): Promise<Address> {
  const client = arcClient();
  const selector = keccak256(stringToHex(signature)).slice(0, 10) as Hex;
  const result = await client.call({ to: address, data: selector });
  if (!result.data) throw new Error(`${signature} on ${address} returned no data`);
  return (`0x${result.data.slice(-40)}`) as Address;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// --- modes ---

async function modeExecutor() {
  const env = loadEnvLocal();
  const key = env.ARC_EXECUTOR_PRIVATE_KEY;
  check(key, "ARC_EXECUTOR_PRIVATE_KEY is not set in .env.local");
  if (!key) return;
  check(/^0x[0-9a-fA-F]{64}$/.test(key), "ARC_EXECUTOR_PRIVATE_KEY must be 0x plus 64 hex characters");

  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key as Hex);

  const declared = env.NEXT_PUBLIC_ARC_TESTNET_EXECUTOR_ADDRESS;
  check(
    declared && declared.toLowerCase() === account.address.toLowerCase(),
    `NEXT_PUBLIC_ARC_TESTNET_EXECUTOR_ADDRESS (${declared}) does not match the key's address (${account.address})`,
  );

  // Signer separation: the Arc executor must not be the platform signer / GenLayer reporter.
  const platformKey = env.AGENT_SIGNER_PRIVATE_KEY;
  if (platformKey && /^0x?[0-9a-fA-F]{64}$/.test(platformKey.replace(/^0x/, "0x"))) {
    const normalized = platformKey.startsWith("0x") ? platformKey : `0x${platformKey}`;
    const platform = privateKeyToAccount(normalized as Hex);
    check(
      platform.address.toLowerCase() !== account.address.toLowerCase(),
      "Arc executor key must differ from AGENT_SIGNER_PRIVATE_KEY",
    );
  }

  // Arc charges gas in native USDC, so a zero balance means settlement cannot proceed.
  const gas = await arcClient().getBalance({ address: account.address });
  check(gas > 0n, `Arc executor ${account.address} has no native USDC for gas`);
  console.log(`executor=${account.address} gasWei=${gas} gasUsdc=${Number(gas) / 1e18}`);
}

async function modeFactory() {
  const env = loadEnvLocal();
  const configured = env.NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY as Address | undefined;
  check(configured, "NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY is not set in .env.local");
  check(
    configured?.toLowerCase() === EXPECTED_FACTORY.toLowerCase(),
    `configured factory ${configured} is not the deployed factory ${EXPECTED_FACTORY}`,
  );
  if (!configured) return;

  const code = await arcClient().getCode({ address: configured });
  check(Boolean(code && code !== "0x"), `no contract code at factory ${configured} on Arc Testnet`);

  const implementation = await readAddress(configured, "treasuryImplementation()");
  check(
    implementation.toLowerCase() === EXPECTED_IMPLEMENTATION.toLowerCase(),
    `factory implementation is ${implementation}, expected ${EXPECTED_IMPLEMENTATION}`,
  );

  const messenger = await readAddress(configured, "tokenMessenger()");
  check(
    messenger.toLowerCase() === ARC_TOKEN_MESSENGER.toLowerCase(),
    `factory CCTP messenger is ${messenger}, expected ${ARC_TOKEN_MESSENGER}`,
  );
  console.log(`factory=${configured} implementation=${implementation} messenger=${messenger}`);
}

function modeChainAllowlist() {
  const env = loadEnvLocal();
  const raw = env.ALLOWED_EVM_CHAIN_IDS ?? "";
  const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
  check(ids.includes(String(ARC_TESTNET_CHAIN_ID)), `ALLOWED_EVM_CHAIN_IDS (${raw}) is missing Arc Testnet`);
  // Adding Arc must not drop the existing Base Sepolia pilot binding.
  check(ids.includes("84532"), `ALLOWED_EVM_CHAIN_IDS (${raw}) no longer includes Base Sepolia 84532`);
  console.log(`allowedEvmChainIds=${ids.join(",")}`);
}

function modeDocs() {
  // Every Arc variable the application code actually reads must be documented, or a fresh
  // deployment silently loses Arc settlement.
  const required = [
    "ARC_EXECUTOR_PRIVATE_KEY",
    "NEXT_PUBLIC_ARC_TESTNET_RPC_URL",
    "NEXT_PUBLIC_ARC_TESTNET_USDC",
    "NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY",
    "ARC_SETTLEMENT_ENABLED",
  ];
  const example = readFileSync(".env.example", "utf8");
  for (const name of required) {
    check(example.includes(name), `.env.example does not document ${name}`);
  }
  const deployment = readFileSync("docs/deployment.md", "utf8");
  for (const name of required) {
    check(deployment.includes(name), `docs/deployment.md does not document ${name}`);
  }
  check(existsSync("docs/arc.md"), "docs/arc.md is missing");
  const arcDoc = readFileSync("docs/arc.md", "utf8");
  check(arcDoc.includes(EXPECTED_FACTORY), "docs/arc.md does not record the deployed factory address");
  console.log(`documented=${required.length} vars in .env.example and docs/deployment.md`);
}

async function modeVaultExecutor() {
  const env = loadEnvLocal();
  const expected = env.NEXT_PUBLIC_ARC_TESTNET_EXECUTOR_ADDRESS;
  check(expected, "NEXT_PUBLIC_ARC_TESTNET_EXECUTOR_ADDRESS is not set");
  if (!expected) return;

  const executor = await readAddress(SMOKE_VAULT, "executor()");
  check(
    executor.toLowerCase() === expected.toLowerCase(),
    `vault ${SMOKE_VAULT} executor is ${executor}, expected the Arc executor ${expected}`,
  );

  // The owner must remain a separate role from the executor.
  const owner = await readAddress(SMOKE_VAULT, "owner()");
  check(
    owner.toLowerCase() !== executor.toLowerCase(),
    `vault owner and executor are both ${owner}; the roles must be separate`,
  );
  console.log(`vault=${SMOKE_VAULT} owner=${owner} executor=${executor}`);
}

async function modeSettle() {
  // Load .env.local into the process so the real executor module sees production-shaped config.
  for (const [key, value] of Object.entries(loadEnvLocal())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const { executeArcVaultPayout } = await import("../apps/web/src/lib/arcVault.ts");

  const client = arcClient();
  const balanceOf = async (account: Address) => {
    const data = `0x70a08231${account.slice(2).padStart(64, "0")}` as Hex;
    const result = await client.call({ to: ARC_USDC, data });
    return BigInt(result.data ?? "0x0");
  };

  const before = await balanceOf(SETTLE_RECIPIENT);
  // A fresh id each run keeps the gate re-verifiable despite on-chain replay protection.
  const requestId = keccak256(stringToHex(`arc-gate-settle-${Date.now()}`));

  const result = await executeArcVaultPayout({
    chainId: ARC_TESTNET_CHAIN_ID,
    vault: SMOKE_VAULT,
    requestId,
    recipient: SETTLE_RECIPIENT,
    amount: SETTLE_AMOUNT.toString(),
  });

  check(result.mode === "arc-vault", `expected arc-vault execution mode, got ${result.mode}`);
  check(/^0x[0-9a-f]{64}$/i.test(result.tx_hash), `invalid Arc tx hash ${result.tx_hash}`);

  const after = await balanceOf(SETTLE_RECIPIENT);
  check(
    after - before === SETTLE_AMOUNT,
    `recipient moved by ${after - before}, expected exactly ${SETTLE_AMOUNT}`,
  );

  // Replay protection must now refuse the same request id.
  const executedData = `0x${keccak256(stringToHex("executed(bytes32)")).slice(2, 10)}${requestId.slice(2)}` as Hex;
  const executed = await client.call({ to: SMOKE_VAULT, data: executedData });
  check(BigInt(executed.data ?? "0x0") === 1n, `executed[${requestId}] was not recorded on chain`);

  console.log(`settled tx=${result.tx_hash} delta=${after - before} requestId=${requestId}`);
}

function modeNoSecrets() {
  // The executor key and platform signer must never reach the pushed tree.
  const env = loadEnvLocal();
  const secrets = [
    env.ARC_EXECUTOR_PRIVATE_KEY,
    env.AGENT_SIGNER_PRIVATE_KEY,
    env.OWNER_SESSION_SECRET,
    env.AGENT_API_KEY_SECRET,
    env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value) && value.length >= 16);
  check(secrets.length > 0, "no secrets were loaded, so this check would pass vacuously");

  const tracked = git("ls-files").split("\n").filter(Boolean);
  for (const file of tracked) {
    let contents: string;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable file
    }
    for (const secret of secrets) {
      check(!contents.includes(secret), `tracked file ${file} contains a secret value`);
    }
  }

  // Env files and the gate ledger must be ignored, not tracked.
  for (const path of [".env.local", "GATES.md"]) {
    check(!tracked.includes(path), `${path} is tracked by git and must not be`);
  }
  check(tracked.includes(".env.example"), ".env.example should be tracked");
  console.log(`scanned=${tracked.length} tracked files against ${secrets.length} secrets`);
}

function modePushed() {
  const status = git("status", "--porcelain");
  const dirty = status
    .split("\n")
    .filter(Boolean)
    // Untracked local-only artifacts are acceptable; staged or modified tracked files are not.
    .filter((line) => !line.startsWith("??"));
  check(dirty.length === 0, `tracked changes are uncommitted:\n${dirty.join("\n")}`);

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const local = git("rev-parse", "HEAD");
  let remote: string;
  try {
    remote = git("rev-parse", `origin/${branch}`);
  } catch {
    failures.push(`origin/${branch} does not exist; the branch was not pushed`);
    return;
  }
  check(local === remote, `local HEAD ${local} differs from origin/${branch} ${remote}`);

  const arcFiles = [
    "contracts/evm/src/AgentTreasury.sol",
    "contracts/evm/src/AgentTreasuryFactory.sol",
    "apps/web/src/lib/arcVault.ts",
    "apps/web/src/lib/executionBackend.ts",
    "docs/arc.md",
  ];
  const tracked = git("ls-files").split("\n");
  for (const file of arcFiles) {
    check(tracked.includes(file), `${file} is not tracked, so it was not pushed`);
  }
  console.log(`branch=${branch} head=${local.slice(0, 12)} pushed=true files=${arcFiles.length}`);
}

function modeVercelEnv() {
  let listing: string;
  try {
    listing = execFileSync("npx", ["vercel", "env", "ls", "production"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    failures.push(`vercel env ls failed: ${(error as Error).message.split("\n")[0]}`);
    return;
  }
  for (const name of [
    "NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY",
    "ARC_EXECUTOR_PRIVATE_KEY",
    "NEXT_PUBLIC_ARC_TESTNET_RPC_URL",
    "ARC_SETTLEMENT_ENABLED",
  ]) {
    check(listing.includes(name), `Vercel production environment is missing ${name}`);
  }
  console.log("vercel production env contains the Arc variables");
}

async function modeDeployment() {
  const url = process.env.DEPLOYMENT_URL ?? readDeploymentUrl();
  check(Boolean(url), "no deployment URL available; set DEPLOYMENT_URL");
  if (!url) return;

  const response = await fetch(new URL("/api/health", url), { cache: "no-store" });
  const body = await response.text();
  check(response.ok, `GET ${url}/api/health returned ${response.status}: ${body.slice(0, 200)}`);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    failures.push(`health endpoint did not return JSON: ${body.slice(0, 200)}`);
    return;
  }
  check(parsed.status === "healthy", `health endpoint reported ${parsed.status}: ${body.slice(0, 300)}`);

  // The gate claims the deployment advertises Arc, so measure that rather than mere liveness.
  const checks = (parsed.checks ?? {}) as Record<string, string>;
  check(
    checks.arc_testnet === "configured",
    `deployment reports arc_testnet=${checks.arc_testnet}, expected "configured"`,
  );

  const chains = (parsed.settlement_chains ?? []) as Array<Record<string, unknown>>;
  const arc = chains.find((chain) => chain.key === "arcTestnet");
  check(arc, "deployment does not advertise Arc Testnet as a settlement chain");
  check(arc?.chain_id === ARC_TESTNET_CHAIN_ID, `advertised Arc chain_id is ${arc?.chain_id}`);
  check(arc?.backend === "arc-vault", `advertised Arc backend is ${arc?.backend}`);
  check(arc?.cctp_domain === 26, `advertised Arc CCTP domain is ${arc?.cctp_domain}`);
  check(arc?.enabled === true, "Arc settlement is advertised but not enabled on the deployment");

  // Adding Arc must not have removed the existing Base Sepolia pilot.
  const base = chains.find((chain) => chain.key === "baseSepolia");
  check(base, "deployment no longer advertises Base Sepolia");
  check(base?.backend === "delegated-7710", `Base Sepolia backend changed to ${base?.backend}`);

  console.log(`deployment=${url} health=${response.status} arc=${checks.arc_testnet} chains=${chains.length}`);
}

function readDeploymentUrl(): string | undefined {
  if (!existsSync("docs/arc-deployment-url.txt")) return undefined;
  return readFileSync("docs/arc-deployment-url.txt", "utf8").trim() || undefined;
}

const MODES: Record<string, () => void | Promise<void>> = {
  executor: modeExecutor,
  factory: modeFactory,
  "chain-allowlist": modeChainAllowlist,
  docs: modeDocs,
  "vault-executor": modeVaultExecutor,
  settle: modeSettle,
  "no-secrets": modeNoSecrets,
  pushed: modePushed,
  "vercel-env": modeVercelEnv,
  deployment: modeDeployment,
};

const mode = process.argv[2];
const run = mode ? MODES[mode] : undefined;
if (!run) {
  console.error(`usage: npx tsx scripts/verify-arc.mts <${Object.keys(MODES).join("|")}>`);
  process.exit(2);
}

function finish(name: string) {
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(`ARC_VERIFY_OK ${name}`);
}

try {
  await run();
} catch (error) {
  console.error(`FAIL: ${mode} threw: ${(error as Error).message}`);
  process.exit(1);
}
finish(mode as string);
