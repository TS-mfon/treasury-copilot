/**
 * Generate the network and deployed-contract tables from the chain registry.
 *
 * These tables are the thing an agent integrator reads to decide where it can be paid, so a stale
 * one is worse than none: the previous hand-written table still listed X Layer (which Circle will
 * not forward to) and omitted Arc entirely. Generating them means the registry is the only place
 * a network is declared.
 *
 * Writes between `<!-- BEGIN:<name> -->` / `<!-- END:<name> -->` markers in README.md and
 * docs/arc.md. Run with `--check` in CI to fail when the tables are out of date.
 *
 *   node scripts/gen-network-tables.mjs
 *   node scripts/gen-network-tables.mjs --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SUPPORTED_CHAINS } from "../packages/shared/dist/index.js";

const check = process.argv.includes("--check");

/** Deployed contracts, recorded with the chain they live on. */
const DEPLOYMENTS = [
  {
    chainId: 5042,
    contract: "AgentTreasury (implementation)",
    address: "0x7aa28657547aAcBf6E83CA7eC3a3073214f600d7",
  },
  {
    chainId: 5042,
    contract: "AgentTreasuryFactory",
    address: "0x450B2D9dad4C72B43620688ef9626F98540CA808",
  },
  {
    chainId: 5042002,
    contract: "AgentTreasury (implementation)",
    address: "0x4eD45045c4e737287cA75d2d2980DE44a6915eeE",
  },
  {
    chainId: 5042002,
    contract: "AgentTreasuryFactory",
    address: "0xe47cE1C562C6355cD9Cf4cF6420Af2cD238456fB",
  },
];

/** Protocol contracts we call but do not own. Identical across chains by Circle's design. */
const EXTERNAL = [
  { name: "CCTP v2 TokenMessenger (mainnet)", address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" },
  { name: "CCTP v2 MessageTransmitter (mainnet)", address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" },
  { name: "CCTP v2 TokenMessenger (testnet)", address: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
  { name: "CCTP v2 MessageTransmitter (testnet)", address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" },
  { name: "Arc USDC (ERC-20 interface, both Arc chains)", address: "0x3600000000000000000000000000000000000000" },
];

const chains = Object.values(SUPPORTED_CHAINS);
const isTestnet = (chain) => chain.cctp?.attestationApiUrl.includes("sandbox") ?? false;
const byId = (a, b) => a.chainId - b.chainId;

function settlementRows(testnet) {
  return chains
    .filter((chain) => !chain.destinationOnly && isTestnet(chain) === testnet)
    .sort(byId)
    .map((chain) => {
      const backend = chain.executionBackend === "arc-vault"
        ? "Owner-deployed `AgentTreasury` vault, paid by the platform executor"
        : "ERC-7715 delegation redelegated to the 1Shot relayer";
      return `| ${chain.name} | \`${chain.chainId}\` | ${chain.cctp?.domain ?? "—"} | ${backend} |`;
    });
}

function destinationRows(testnet) {
  return chains
    .filter((chain) => isTestnet(chain) === testnet && chain.cctp)
    .sort((a, b) => a.cctp.domain - b.cctp.domain || byId(a, b))
    .map((chain) => {
      const role = chain.destinationOnly ? "Destination" : "Settlement + destination";
      return `| ${chain.name} | \`${chain.chainId}\` | ${chain.cctp.domain} | ${role} | \`${chain.usdcAddress}\` |`;
    });
}

const settlementTable = [
  "| Network | Chain ID | CCTP domain | How an approved payment settles |",
  "| --- | ---: | ---: | --- |",
  ...settlementRows(false),
  ...settlementRows(true),
].join("\n");

const destinationsTable = [
  "**Mainnet** — Circle's production attestation service (`iris-api.circle.com`).",
  "",
  "| Network | Chain ID | CCTP domain | Role | USDC |",
  "| --- | ---: | ---: | --- | --- |",
  ...destinationRows(false),
  "",
  "**Testnet** — Circle's sandbox attestation service (`iris-api-sandbox.circle.com`).",
  "",
  "| Network | Chain ID | CCTP domain | Role | USDC |",
  "| --- | ---: | ---: | --- | --- |",
  ...destinationRows(true),
].join("\n");

const nameFor = (chainId) =>
  chains.find((chain) => chain.chainId === chainId)?.name ?? String(chainId);
const explorerFor = (chainId) =>
  chains.find((chain) => chain.chainId === chainId)?.explorerUrl ?? "";

const deploymentsTable = [
  "Contracts this project deploys and owns:",
  "",
  "| Network | Chain ID | Contract | Address |",
  "| --- | ---: | --- | --- |",
  ...DEPLOYMENTS.sort((a, b) => b.chainId - a.chainId || a.contract.localeCompare(b.contract)).map(
    ({ chainId, contract, address }) => {
      const explorer = explorerFor(chainId);
      const link = explorer ? `[\`${address}\`](${explorer}/address/${address})` : `\`${address}\``;
      return `| ${nameFor(chainId)} | \`${chainId}\` | ${contract} | ${link} |`;
    },
  ),
  "",
  "Each owner's treasury is a minimal-proxy clone deployed by the factory above, so its address is",
  "specific to that owner and is shown in the app after setup. The implementation is locked in its",
  "constructor and reverts `already initialized` if called directly, so only clones are usable.",
  "",
  "Protocol contracts called but not owned by this project. Circle deploys CCTP v2 at the same",
  "address on every supported chain, so these are constants rather than per-chain configuration:",
  "",
  "| Contract | Address |",
  "| --- | --- |",
  ...EXTERNAL.map(({ name, address }) => `| ${name} | \`${address}\` |`),
].join("\n");

const BLOCKS = {
  "settlement-networks": settlementTable,
  "cctp-destinations": destinationsTable,
  "deployed-contracts": deploymentsTable,
};

const FILES = ["README.md", "docs/arc.md"];
let stale = false;

for (const file of FILES) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const before = text;
  for (const [name, body] of Object.entries(BLOCKS)) {
    const begin = `<!-- BEGIN:${name} -->`;
    const end = `<!-- END:${name} -->`;
    const startIndex = text.indexOf(begin);
    const endIndex = text.indexOf(end);
    if (startIndex === -1 || endIndex === -1) continue;
    const generated = `${begin}\n<!-- Generated by scripts/gen-network-tables.mjs — edit the chain registry, not this table. -->\n\n${body}\n\n${end}`;
    text = text.slice(0, startIndex) + generated + text.slice(endIndex + end.length);
  }
  if (text !== before) {
    if (check) {
      console.error(`${file} network tables are out of date; run node scripts/gen-network-tables.mjs`);
      stale = true;
    } else {
      writeFileSync(file, text);
      console.log(`updated ${file}`);
    }
  } else {
    console.log(`${file} already current`);
  }
}

if (stale) process.exit(1);

const settlement = chains.filter((chain) => !chain.destinationOnly).length;
const destinations = chains.filter((chain) => chain.cctp).length;
console.log(`NETWORK_TABLES_OK settlement=${settlement} cctp_capable=${destinations}`);
