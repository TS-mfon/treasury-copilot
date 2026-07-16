import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isAddress, type Address } from "viem";

const NONCE_COOKIE = "tcp_owner_nonce";
const SESSION_COOKIE = "tcp_owner_session";
const TTL_SECONDS = 60 * 60 * 12;

type SignedPayload = { owner: Address; nonce?: string; exp: number; type: "nonce" | "session" };

function secret() {
  const value = process.env.OWNER_SESSION_SECRET ?? process.env.AGENT_API_KEY_SECRET ?? process.env.JWT_SIGNING_SECRET;
  if (!value || value.length < 24) throw new Error("Owner session secret is not configured");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(payload: SignedPayload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${raw}.${sign(raw)}`;
}

function decode(value: string | undefined, expectedType: SignedPayload["type"]): SignedPayload {
  if (!value) throw new Error("Owner authentication required");
  const [raw, signature] = value.split(".");
  if (!raw || !signature) throw new Error("Invalid owner session");
  const expected = sign(raw);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("Invalid owner session");
  const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SignedPayload;
  if (parsed.type !== expectedType || !isAddress(parsed.owner) || !Number.isInteger(parsed.exp) || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Owner session expired");
  }
  return parsed;
}

export function ownerNonce(owner: Address) {
  const nonce = randomBytes(20).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 5 * 60;
  return { nonce, token: encode({ owner, nonce, exp, type: "nonce" }), exp };
}

export function verifyOwnerNonce(token: string | undefined, owner: Address, nonce: string) {
  const payload = decode(token, "nonce");
  if (payload.owner.toLowerCase() !== owner.toLowerCase() || payload.nonce !== nonce) throw new Error("Owner login challenge does not match");
}

export function ownerSession(owner: Address) {
  return encode({ owner, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS, type: "session" });
}

export function sessionOwner(token: string | undefined) {
  return decode(token, "session").owner;
}

export const ownerAuthCookies = { NONCE_COOKIE, SESSION_COOKIE, TTL_SECONDS };
