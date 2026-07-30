import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  isAddress,
  keccak256,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { canonicalJson } from "@/lib/ownerActions";

const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_INVOICE_AGE_SECONDS = 90 * 24 * 60 * 60;

interface EvidenceContext {
  chainId: number;
  policy: Address;
  token: Address;
  recipient: Address;
  amountUnits: bigint;
}

interface CommonInvoice {
  invoice_id: string;
  merchant_id: string;
  expected_recipient: Address;
  expected_amount: string;
  issued_at: number;
  expires_at?: number;
}

export type VerifiedEvidence =
  | (CommonInvoice & {
      type: "invoice_url";
      uri: string;
      merchant_domain: string;
      sha256: Hex;
      content_type: string;
      verified: true;
    })
  | (CommonInvoice & {
      type: "signed_invoice";
      signer: Address;
      signature: Hex;
      content_hash: Hex;
      verified: true;
    });

export interface VerifiedEvidenceBundle {
  items: VerifiedEvidence[];
  canonicalJson: string;
  digest: Hex;
  invoiceKey: string;
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be ${min}-${max} characters`);
  }
  return normalized;
}

function timestamp(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a Unix timestamp in seconds`);
  return parsed;
}

function hex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte 0x-prefixed hex digest`);
  }
  return value.toLowerCase() as Hex;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return value as Address;
}

function assertInvoiceTimes(issuedAt: number, expiresAt?: number) {
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 5 * 60) throw new Error("Evidence issued_at cannot be in the future");
  if (now - issuedAt > MAX_INVOICE_AGE_SECONDS) throw new Error("Evidence is older than 90 days");
  if (expiresAt !== undefined && expiresAt <= now) throw new Error("Evidence has expired");
  if (expiresAt !== undefined && expiresAt <= issuedAt) throw new Error("Evidence expires_at must be after issued_at");
}

function isPrivateAddress(raw: string) {
  const normalized = raw.toLowerCase().split("%")[0] ?? raw.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const octets = normalized.split(".").map(Number);
  const [a, b] = octets;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224
  );
}

async function assertPublicHost(hostname: string) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("Evidence hostname did not resolve");
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("Evidence URL resolves to a private, local, or reserved address");
  }
}

async function fetchEvidence(uri: string) {
  let current = new URL(uri);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (current.protocol !== "https:") throw new Error("Evidence URLs must use HTTPS");
    if (current.username || current.password) throw new Error("Evidence URLs cannot contain credentials");
    if (current.port && current.port !== "443") throw new Error("Evidence URLs must use the standard HTTPS port");
    await assertPublicHost(current.hostname);

    const response = await fetch(current, {
      method: "GET",
      headers: { accept: "application/json, text/plain, application/pdf" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Evidence redirect did not include a location");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Evidence URL returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_EVIDENCE_BYTES) throw new Error("Evidence response exceeds 256 KiB");
    const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
    if (!(contentType.startsWith("text/") || contentType === "application/json" || contentType === "application/pdf")) {
      throw new Error(`Unsupported evidence content type: ${contentType}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error("Evidence response exceeds 256 KiB");
    return {
      finalUrl: current.toString(),
      hostname: current.hostname.toLowerCase(),
      contentType,
      sha256: `0x${createHash("sha256").update(bytes).digest("hex")}` as Hex,
    };
  }
  throw new Error("Evidence URL exceeded the redirect limit");
}

function commonInvoice(raw: Record<string, unknown>, context: EvidenceContext): CommonInvoice {
  const invoiceId = text(raw.invoice_id, "evidence.invoice_id", 1, 128);
  const merchantId = text(raw.merchant_id, "evidence.merchant_id", 1, 128);
  const recipient = address(raw.expected_recipient, "evidence.expected_recipient");
  const expectedAmount = text(raw.expected_amount, "evidence.expected_amount", 1, 96);
  const issuedAt = timestamp(raw.issued_at, "evidence.issued_at");
  const expiresAt = raw.expires_at === undefined ? undefined : timestamp(raw.expires_at, "evidence.expires_at");
  assertInvoiceTimes(issuedAt, expiresAt);
  if (recipient.toLowerCase() !== context.recipient.toLowerCase()) {
    throw new Error("Evidence recipient does not match the spend recipient");
  }
  if (BigInt(expectedAmount) !== context.amountUnits) {
    throw new Error("Evidence expected_amount must be the exact token amount in base units");
  }
  return {
    invoice_id: invoiceId,
    merchant_id: merchantId,
    expected_recipient: recipient,
    expected_amount: expectedAmount,
    issued_at: issuedAt,
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
}

async function verifyUrlEvidence(raw: Record<string, unknown>, context: EvidenceContext): Promise<VerifiedEvidence> {
  const common = commonInvoice(raw, context);
  const uri = text(raw.uri, "evidence.uri", 1, MAX_URL_LENGTH);
  const expectedHash = hex32(raw.sha256, "evidence.sha256");
  const merchantDomain = text(raw.merchant_domain, "evidence.merchant_domain", 1, 253).toLowerCase();
  const fetched = await fetchEvidence(uri);
  if (fetched.sha256 !== expectedHash) throw new Error("Evidence SHA-256 does not match the fetched invoice");
  if (fetched.hostname !== merchantDomain && !fetched.hostname.endsWith(`.${merchantDomain}`)) {
    throw new Error("Evidence URL hostname does not match merchant_domain");
  }
  return {
    type: "invoice_url",
    ...common,
    uri: fetched.finalUrl,
    merchant_domain: merchantDomain,
    sha256: fetched.sha256,
    content_type: fetched.contentType,
    verified: true,
  };
}

async function verifySignedEvidence(raw: Record<string, unknown>, context: EvidenceContext): Promise<VerifiedEvidence> {
  const common = commonInvoice(raw, context);
  const signer = address(raw.signer, "evidence.signer");
  const signature = text(raw.signature, "evidence.signature", 132, 132) as Hex;
  const contentHash = hex32(raw.content_hash, "evidence.content_hash");
  const valid = await verifyTypedData({
    address: signer,
    domain: {
      name: "Treasury Copilot Invoice",
      version: "1",
      chainId: context.chainId,
      verifyingContract: context.policy,
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
      invoiceId: common.invoice_id,
      merchantId: common.merchant_id,
      recipient: common.expected_recipient,
      token: context.token,
      amount: context.amountUnits,
      issuedAt: BigInt(common.issued_at),
      expiresAt: BigInt(common.expires_at ?? 0),
      contentHash,
    },
    signature,
  });
  if (!valid) throw new Error("Signed invoice signature is invalid");
  return {
    type: "signed_invoice",
    ...common,
    signer,
    signature,
    content_hash: contentHash,
    verified: true,
  };
}

export async function verifyEvidence(value: unknown, context: EvidenceContext): Promise<VerifiedEvidenceBundle> {
  if (value === undefined) {
    return { items: [], canonicalJson: "[]", digest: keccak256(stringToHex("[]")), invoiceKey: "" };
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`evidence must contain 1-${MAX_EVIDENCE_ITEMS} items`);
  }

  const items: VerifiedEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Each evidence item must be an object");
    const raw = item as Record<string, unknown>;
    if (raw.type === "invoice_url") items.push(await verifyUrlEvidence(raw, context));
    else if (raw.type === "signed_invoice") items.push(await verifySignedEvidence(raw, context));
    else throw new Error("evidence.type must be invoice_url or signed_invoice");
  }

  const first = items[0]!;
  for (const item of items.slice(1)) {
    if (item.invoice_id !== first.invoice_id || item.merchant_id !== first.merchant_id) {
      throw new Error("All evidence items must describe the same merchant invoice");
    }
  }
  const normalized = canonicalJson(items);
  return {
    items,
    canonicalJson: normalized,
    digest: keccak256(stringToHex(normalized)),
    invoiceKey: keccak256(stringToHex(canonicalJson({
      merchant_id: first.merchant_id.toLowerCase(),
      invoice_id: first.invoice_id.toLowerCase(),
    }))),
  };
}
