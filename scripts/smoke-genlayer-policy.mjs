import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const policy = process.env.GENLAYER_POLICY ?? "0x39F49354D6064a0603011A7E3c70c45615Da3A3B";
const delegatedAccount = process.env.DELEGATED_ACCOUNT ?? "0xEd9EDd8586b20524CafA4F568413C504C9B03172";
const recipient = process.env.RECIPIENT ?? "0x1072e78B72840BbC921493ea1C97dC5CAA54598F";
const chainId = Number(process.env.EVM_CHAIN_ID ?? "84532");
const password = process.env.GENLAYER_ACCOUNT_PASSWORD ?? "treasury-copilot-ci-pass";

function readSignerKey() {
  if (process.env.AGENT_SIGNER_PRIVATE_KEY) return process.env.AGENT_SIGNER_PRIVATE_KEY;
  const envFile = resolve(".env.agent-signer.local");
  const contents = readFileSync(envFile, "utf8");
  const line = contents.split(/\r?\n/).find((item) => item.startsWith("AGENT_SIGNER_PRIVATE_KEY="));
  if (!line) throw new Error("AGENT_SIGNER_PRIVATE_KEY is missing");
  return line.split("=").slice(1).join("=").trim();
}

const signerKey = readSignerKey();
const account = privateKeyToAccount(signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`);

const types = {
  TreasuryRequest: [
    { name: "policy", type: "address" },
    { name: "delegatedAccount", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amountAtto", type: "uint256" },
    { name: "category", type: "string" },
    { name: "justificationHash", type: "bytes32" },
    { name: "requestId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

function runGenlayer(args) {
  let lastOutput = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync("genlayer", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `${password}\n`,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    lastOutput = output;
    if (result.status === 0) return output;
    if (!/fetch failed|ETIMEDOUT|ENETUNREACH|-32429|-32028/.test(output) || attempt === 3) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2500);
  }
  throw new Error(lastOutput.split(/\r?\n/).slice(-30).join("\n"));
}

function summarizeWrite(name, output) {
  const hash = output.match(/Write Transaction Hash:\s*(0x[a-fA-F0-9]{64})/)?.[1] ?? "";
  const result = output.match(/result_name:\s*'([^']+)'/)?.[1] ?? "";
  const status = output.match(/status_name:\s*'([^']+)'/)?.[1] ?? "";
  const verdict = output.match(/"verdict"\s*:\s*"([^"]+)"/)?.[1] ?? output.match(/"verdict":"([^"]+)"/)?.[1] ?? output.match(/verdict:\s*'([^']+)'/)?.[1] ?? "";
  const reasoning = output.match(/"reasoning"\s*:\s*"([^"]+)"/)?.[1] ?? output.match(/"reasoning":"([^"]+)"/)?.[1] ?? output.match(/reasoning:\s*'([^']+)'/)?.[1] ?? "";
  console.log(JSON.stringify({ name, hash, result, status, verdict, reasoning }, null, 2));
  if (output.includes("UNDETERMINED")) throw new Error(`${name} hit UNDETERMINED`);
  if (result && result !== "MAJORITY_AGREE") throw new Error(`${name} did not majority agree: ${result}`);
  return { hash, result, status, verdict, reasoning };
}

async function buildArgs({ amountAtto, category, justification, salt }) {
  const requestId = keccak256(stringToHex(`${policy}:${delegatedAccount}:${recipient}:${amountAtto}:${category}:${justification}:${Date.now()}:${salt}`));
  const justificationHash = keccak256(stringToHex(justification));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await account.signTypedData({
    domain: {
      name: "Treasury Copilot",
      version: "1",
      chainId,
      verifyingContract: policy,
    },
    types,
    primaryType: "TreasuryRequest",
    message: {
      policy,
      delegatedAccount,
      recipient,
      amountAtto: BigInt(amountAtto),
      category,
      justificationHash,
      requestId,
      deadline,
    },
  });
  return {
    requestId,
    args: [
      policy,
      "submit_request",
      "--args",
      recipient,
      String(amountAtto),
      category,
      justification,
      justificationHash,
      signature,
      requestId,
      deadline.toString(),
    ],
  };
}

const approval = await buildArgs({
  amountAtto: "4000000",
  category: "software",
  justification: "Monthly production API bill for the deployed Treasury Copilot backend.",
  salt: "approve",
});
const approvalOutput = runGenlayer(["write", ...approval.args]);
summarizeWrite("approval-submit-request", approvalOutput);

const txHash = "0x" + "1".repeat(64);
const recordOutput = runGenlayer(["write", policy, "record_execution", "--args", approval.requestId, txHash]);
summarizeWrite("record-execution", recordOutput);

const denial = await buildArgs({
  amountAtto: "26000000",
  category: "software",
  justification: "Oversized request that should fail the per-transaction cap.",
  salt: "deny",
});
const denialOutput = runGenlayer(["write", ...denial.args]);
summarizeWrite("denial-submit-request", denialOutput);
