/**
 * Gate oracle for GenLayer policy V6.
 *
 * Prints `POLICY_V6_OK <mode>` only when every assertion in that mode passes.
 *
 *   npx tsx scripts/verify-policy-v6.mts <mode>
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CONTRACT = "contracts/genlayer/TreasuryPolicy.py";
const DEPLOYED_RECORD = "docs/policy-v6-address.txt";

const failures: string[] = [];
function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function modeSource() {
  const source = readFileSync(CONTRACT, "utf8");

  check(source.includes('"contract_version": "6"'), "get_policy does not report contract_version 6");

  // Storage the vault binding and destination allowlist depend on.
  for (const field of [
    "settlement_backend: str",
    "vault_address: str",
    "allowed_destination_chains: TreeMap[str, bool]",
    "destination_chain_order: DynArray[str]",
  ]) {
    check(source.includes(field), `contract is missing storage field: ${field}`);
  }

  // Per-request destination and independent bridge lifecycle state.
  for (const field of [
    "destination_chain_id: str",
    "route: str",
    "bridge_tx_hash: str",
    "attestation_status: str",
    "destination_tx_hash: str",
  ]) {
    check(source.includes(field), `PolicyRequest is missing field: ${field}`);
  }

  for (const method of [
    "def register_vault(",
    "def set_destination_chain_entry(",
    "def record_bridge_initiated(",
    "def record_bridge_attested(",
    "def _is_allowed_destination(",
    "def _active_destination_chains(",
  ]) {
    check(source.includes(method), `contract is missing method: ${method}`);
  }

  // The destination must reach policy review, or owner policy text could not constrain it.
  check(
    source.includes("destination_chain_id: {destination_chain_id}"),
    "the LLM prompt does not include the destination chain",
  );
  // The approval relay must tell the executor which backend and route to use.
  for (const key of ['"settlement_backend": self.settlement_backend', '"route": req.route']) {
    check(source.includes(key), `the approval relay is missing ${key}`);
  }
  console.log("contract source declares V6 storage, writes, prompt and relay fields");
}

function modeDeterministicDenial() {
  // Runs the real contract source under stubbed GenVM primitives. Asserts, among other things,
  // that a disallowed destination never reaches the LLM.
  const output = execFileSync("python3", ["scripts/policy_v6_harness.py"], { encoding: "utf8" });
  check(output.includes("HARNESS_OK"), `policy harness did not pass:\n${output}`);
  console.log(output.trim());
}

function modeDeployed() {
  if (!existsSync(DEPLOYED_RECORD)) {
    failures.push(`${DEPLOYED_RECORD} is missing; deploy a V6 policy and record its address`);
    return;
  }
  const address = readFileSync(DEPLOYED_RECORD, "utf8").trim();
  check(/^0x[0-9a-fA-F]{40}$/.test(address), `recorded policy address is malformed: ${address}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return;

  const password = process.env.GENLAYER_KEYSTORE_PASSWORD;
  if (!password) {
    failures.push("GENLAYER_KEYSTORE_PASSWORD is not set, so the deployed policy cannot be read");
    return;
  }

  // Read through the GenLayer CLI so the assertion uses the same path an operator would.
  let output: string;
  try {
    output = execFileSync("genlayer", ["call", address, "get_policy"], {
      encoding: "utf8",
      input: `${password}\n`,
      timeout: 300_000,
    });
  } catch (error) {
    failures.push(`genlayer call failed: ${(error as Error).message.split("\n")[0]}`);
    return;
  }

  const field = (name: string) => {
    const match = new RegExp(`${name}:\\s*'([^']*)'`).exec(output);
    return match?.[1];
  };

  check(field("contract_version") === "6", `deployed policy reports version ${field("contract_version")}`);
  check(
    field("settlement_backend") === "arc-vault",
    `deployed policy backend is ${field("settlement_backend")}, expected arc-vault`,
  );
  // A vault-settled policy that has not registered its vault cannot execute, so the binding is
  // only complete once this is true.
  check(/vault_registered:\s*true/.test(output), "deployed policy has no registered vault");
  check(
    /vault_address:\s*'0x[0-9a-fA-F]{40}'/.test(output),
    "deployed policy has no vault address",
  );
  // The destination allowlist must contain the settlement chain plus the configured extra chain.
  check(output.includes("'5042002'"), "deployed policy does not permit Arc Testnet as a destination");
  check(output.includes("'84532'"), "deployed policy does not permit Base Sepolia as a destination");

  console.log(
    `policy=${address} version=${field("contract_version")} backend=${field("settlement_backend")} ` +
    `vault=${field("vault_address")}`,
  );
}

function modeDocs() {
  const deployment = readFileSync("docs/deployment.md", "utf8");
  for (const phrase of ["register_vault", "destination_chain", "V6"]) {
    check(deployment.includes(phrase), `docs/deployment.md does not mention ${phrase}`);
  }
  const arc = readFileSync("docs/arc.md", "utf8");
  check(arc.includes("V6"), "docs/arc.md does not mention policy V6");
  const guide = readFileSync("docs/arc-testing-guide.md", "utf8");
  check(guide.includes("destination_chain"), "the testing guide does not cover destination_chain");
  console.log("deployment, arc and testing docs cover V6 and the destination chain");
}

const MODES: Record<string, () => void | Promise<void>> = {
  source: modeSource,
  "deterministic-denial": modeDeterministicDenial,
  deployed: modeDeployed,
  docs: modeDocs,
};

const mode = process.argv[2];
const run = mode ? MODES[mode] : undefined;
if (!run) {
  console.error(`usage: npx tsx scripts/verify-policy-v6.mts <${Object.keys(MODES).join("|")}>`);
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
console.log(`POLICY_V6_OK ${mode}`);
