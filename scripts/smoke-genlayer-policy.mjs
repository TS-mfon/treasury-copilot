import { spawnSync } from "node:child_process";
import { keccak256, stringToHex } from "viem";

const policy = requireEnv("GENLAYER_POLICY");
const agentAddress = requireEnv("AGENT_ADDRESS");
const platformAddress = requireEnv("PLATFORM_ADDRESS");
const password = requireEnv("GENLAYER_ACCOUNT_PASSWORD");
const recipient = process.env.RECIPIENT ?? "0x0000000000000000000000000000000000000001";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function runGenlayer(args, attempts = 4) {
  let lastOutput = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("genlayer", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `${password}\n`,
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    lastOutput = output;
    if (result.status === 0) return output;

    const retryable = /fetch failed|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|-32429|-32028/.test(output);
    if (!retryable || attempt === attempts) break;
    sleep(attempt * 4000);
  }
  throw new Error(lastOutput.split(/\r?\n/).slice(-40).join("\n"));
}

function transactionHash(output) {
  const hash = output.match(/(?:Write )?Transaction Hash:\s*(0x[a-fA-F0-9]{64})/)?.[1];
  if (!hash) throw new Error("GenLayer CLI output did not include a transaction hash");
  return hash;
}

function assertFinalizedSuccess(name, output) {
  if (!/status_name:\s*'FINALIZED'/.test(output)) {
    throw new Error(`${name} did not reach FINALIZED`);
  }
  if (/result_name:\s*'UNDETERMINED'/.test(output)) {
    throw new Error(`${name} finalized as UNDETERMINED`);
  }
}

function waitForFinalized(name, hash) {
  const output = runGenlayer([
    "receipt",
    hash,
    "--status",
    "FINALIZED",
    "--retries",
    "120",
    "--interval",
    "3000",
  ]);
  assertFinalizedSuccess(name, output);
  return output;
}

function readRequest(requestId, requireFinalized = true) {
  const output = runGenlayer(["call", policy, "get_request", "--args", requestId]);
  const verdict = output.match(/verdict:\s*'([^']+)'/)?.[1] ?? "";
  const reasoning = output.match(/reasoning:\s*'([^']+)'/)?.[1] ?? "";
  const finalized = output.match(/finalized:\s*(true|false)/)?.[1] === "true";
  const executionStatus = output.match(/execution_status:\s*'([^']+)'/)?.[1] ?? "";
  if (!verdict || !reasoning || (requireFinalized && !finalized)) {
    throw new Error(`Final request state is incomplete:\n${output}`);
  }
  return { verdict, reasoning, finalized, execution_status: executionStatus };
}

async function signedRequest({ amountAtto, category, justification, label }) {
  const requestId = keccak256(
    stringToHex(`${policy}:${agentAddress}:${recipient}:${amountAtto}:${category}:${label}:${Date.now()}`),
  );
  const justificationHash = keccak256(stringToHex(justification));
  const evidenceJson = "[]";
  const evidenceDigest = keccak256(stringToHex(evidenceJson));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
  return {
    requestId,
    args: [
      recipient,
      amountAtto,
      category,
      justification,
      justificationHash,
      evidenceJson,
      evidenceDigest,
      "",
      requestId,
      deadline.toString(),
      agentAddress,
    ],
  };
}

async function submitAndFinalize(example) {
  const request = await signedRequest(example);
  const submitOutput = runGenlayer(["write", policy, "queue_request", "--args", ...request.args]);
  const submitHash = transactionHash(submitOutput);
  waitForFinalized(`${example.label} submission`, submitHash);
  const state = readRequest(request.requestId, false);
  let reviewHash = null;
  // V4 compatibility only. V5 performs comparative review in queue_request.
  if (state.verdict === "pending") {
    const reviewOutput = runGenlayer(["write", policy, "review_request", "--args", request.requestId]);
    reviewHash = transactionHash(reviewOutput);
    waitForFinalized(`${example.label} review`, reviewHash);
    state = readRequest(request.requestId);
  }

  return {
    label: example.label,
    request_id: request.requestId,
    submission_tx_hash: submitHash,
    legacy_review_tx_hash: reviewHash,
    state,
  };
}

const examples = [
  {
    label: "small-policy-reviewed",
    amountAtto: "4000000",
    category: "software",
    justification: "Monthly production API bill for Treasury Copilot infrastructure.",
  },
  {
    label: "cap-denied",
    amountAtto: "26000000",
    category: "software",
    justification: "Oversized software request that must fail the per-transaction cap.",
  },
  {
    label: "policy-evaluated",
    amountAtto: "10000000",
    category: "infrastructure",
    justification: "Quarterly cloud observability service used by the production engineering team.",
  },
];

const results = [];
for (const example of examples) {
  results.push(await submitAndFinalize(example));
}

if (results[0].state.verdict !== "approved") {
  throw new Error("The 4 USDC example was not approved by policy review");
}
if (results[1].state.verdict !== "denied") {
  throw new Error("The 26 USDC example was not denied by the cap");
}

console.log(JSON.stringify({
  policy,
  agent_address: agentAddress,
  platform_address: platformAddress,
  note: "This smoke test validates GenLayer policy consensus and finality only; it does not fabricate a 1Shot payout.",
  results,
}, null, 2));
