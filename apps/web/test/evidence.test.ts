import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyEvidence } from "../src/lib/evidence";

const merchant = privateKeyToAccount(`0x${"31".repeat(32)}`);
const policy = `0x${"44".repeat(20)}` as const;
const token = `0x${"55".repeat(20)}` as const;
const recipient = `0x${"66".repeat(20)}` as const;

async function signedInvoice(overrides: Record<string, unknown> = {}) {
  const issuedAt = Math.floor(Date.now() / 1000) - 60;
  const invoice = {
    invoice_id: "invoice-4471",
    merchant_id: "vercel",
    expected_recipient: recipient,
    expected_amount: "2500000",
    issued_at: issuedAt,
    expires_at: issuedAt + 3600,
    content_hash: `0x${"77".repeat(32)}`,
    ...overrides,
  };
  const signature = await merchant.signTypedData({
    domain: {
      name: "Treasury Copilot Invoice",
      version: "1",
      chainId: 84532,
      verifyingContract: policy,
    },
    types: {
      Invoice: [
        { name: "invoiceId", type: "string" },
        { name: "merchantId", type: "string" },
        { name: "recipient", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "issuedAt", type: "uint256" },
        { name: "expiresAt", type: "uint256" },
        { name: "contentHash", type: "bytes32" },
      ],
    },
    primaryType: "Invoice",
    message: {
      invoiceId: String(invoice.invoice_id),
      merchantId: String(invoice.merchant_id),
      recipient: invoice.expected_recipient as `0x${string}`,
      token,
      amount: BigInt(String(invoice.expected_amount)),
      issuedAt: BigInt(Number(invoice.issued_at)),
      expiresAt: BigInt(Number(invoice.expires_at)),
      contentHash: invoice.content_hash as `0x${string}`,
    },
  });
  return { type: "signed_invoice", signer: merchant.address, signature, ...invoice };
}

test("signed invoice evidence binds signature, recipient, token, and exact units", async () => {
  const result = await verifyEvidence([await signedInvoice()], {
    chainId: 84532,
    policy,
    token,
    recipient,
    amountUnits: 2_500_000n,
  });
  assert.equal(result.items[0]?.type, "signed_invoice");
  assert.equal(result.items[0]?.verified, true);
  assert.match(result.digest, /^0x[0-9a-f]{64}$/);
  assert.match(result.invoiceKey, /^0x[0-9a-f]{64}$/);
});

test("evidence rejects recipient substitution", async () => {
  const evidence = await signedInvoice({
    expected_recipient: `0x${"88".repeat(20)}`,
  });
  await assert.rejects(() => verifyEvidence([evidence], {
    chainId: 84532,
    policy,
    token,
    recipient,
    amountUnits: 2_500_000n,
  }), /recipient/);
});

test("evidence rejects amount substitution", async () => {
  const evidence = await signedInvoice({ expected_amount: "2500001" });
  await assert.rejects(() => verifyEvidence([evidence], {
    chainId: 84532,
    policy,
    token,
    recipient,
    amountUnits: 2_500_000n,
  }), /expected_amount/);
});
