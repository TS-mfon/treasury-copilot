import { readFileSync } from "node:fs";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildTreasuryRequestDomain,
  treasuryRequestTypes,
} from "../packages/shared/dist/index.js";

const envText = readFileSync("/home/sudodave/.env.build", "utf8");
const privateKeyMatch = envText.match(/private key\s*:\s*(0x[0-9a-fA-F]{64})/i);
if (!privateKeyMatch) {
  throw new Error("private key not found in /home/sudodave/.env.build");
}

const [
  policy,
  treasury,
  recipient,
  amountAtto,
  category,
  justification,
  nonce = String(Date.now()),
] = process.argv.slice(2);

if (!policy || !treasury || !recipient || !amountAtto || !category || !justification) {
  throw new Error("usage: node scripts/sign-request.mjs <policy> <treasury> <recipient> <amountAtto> <category> <justification> [nonce]");
}

const account = privateKeyToAccount(privateKeyMatch[1]);
const requestId = keccak256(stringToHex(`${policy}:${treasury}:${recipient}:${amountAtto}:${category}:${justification}:${nonce}`));
const justificationHash = keccak256(stringToHex(justification));
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const message = {
  policy,
  treasury,
  recipient,
  amountAtto: BigInt(amountAtto),
  category,
  justificationHash,
  requestId,
  deadline,
};

const signature = await account.signTypedData({
  domain: buildTreasuryRequestDomain(84532, policy),
  types: treasuryRequestTypes,
  primaryType: "TreasuryRequest",
  message,
});

console.log(JSON.stringify({
  signer: account.address,
  args: [
    recipient,
    amountAtto,
    category,
    justification,
    justificationHash,
    signature,
    requestId,
    deadline.toString(),
  ],
}, null, 2));
