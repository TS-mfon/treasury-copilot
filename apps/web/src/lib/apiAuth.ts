import { createHmac, timingSafeEqual } from "node:crypto";
import { isAddress, type Address } from "viem";

export interface AgentApiKeyClaims {
  type: "agent";
  version: 1;
  keyId: string;
  keyVersion: number;
  owner: Address;
  agent: Address;
  policy: Address;
  delegatedAccount: Address;
  chainId: number;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  issuedAt: number;
  expiresAt?: number;
}

function secret() {
  const value = process.env.AGENT_API_KEY_SECRET ?? process.env.JWT_SIGNING_SECRET;
  if (!value || value.length < 24) throw new Error("Agent API key secret is not configured");
  return value;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`Invalid ${label} in API key`);
  return value as Address;
}

function normalizeClaims(raw: Record<string, unknown>): AgentApiKeyClaims {
  const chainId = Number(raw.chainId);
  const tokenDecimals = Number(raw.tokenDecimals);
  const issuedAt = Number(raw.issuedAt);
  const keyVersion = Number(raw.keyVersion);
  const expiresAt = raw.expiresAt === undefined ? undefined : Number(raw.expiresAt);
  if (raw.type !== "agent" || raw.version !== 1) throw new Error("Unsupported API key");
  if (typeof raw.keyId !== "string" || raw.keyId.length < 8) throw new Error("Invalid key id in API key");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id in API key");
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) throw new Error("Invalid token decimals in API key");
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) throw new Error("Invalid issued timestamp in API key");
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) throw new Error("Invalid key version in API key");
  if (expiresAt !== undefined && (!Number.isInteger(expiresAt) || expiresAt <= issuedAt)) throw new Error("Invalid expiry in API key");
  if (expiresAt !== undefined && expiresAt < Math.floor(Date.now() / 1000)) throw new Error("API key expired");
  if (typeof raw.tokenSymbol !== "string" || raw.tokenSymbol.trim() === "") throw new Error("Invalid token symbol in API key");

  return {
    type: "agent",
    version: 1,
    keyId: raw.keyId,
    keyVersion,
    owner: assertAddress(raw.owner, "owner"),
    agent: assertAddress(raw.agent, "agent"),
    policy: assertAddress(raw.policy, "policy"),
    delegatedAccount: assertAddress(raw.delegatedAccount, "delegated account"),
    chainId,
    token: assertAddress(raw.token, "token"),
    tokenSymbol: raw.tokenSymbol,
    tokenDecimals,
    issuedAt,
    expiresAt,
  };
}

export function issueAgentApiKey(claims: Omit<AgentApiKeyClaims, "type" | "version" | "issuedAt"> & { issuedAt?: number }) {
  const payload = base64UrlEncode(JSON.stringify({
    ...claims,
    type: "agent",
    version: 1,
    issuedAt: claims.issuedAt ?? Math.floor(Date.now() / 1000),
  }));
  return `tcp_${payload}.${signPayload(payload)}`;
}

export function verifyAgentApiKey(token: string): AgentApiKeyClaims {
  try {
    const normalized = token.trim();
    if (!normalized.startsWith("tcp_")) throw new Error("Missing agent API key");
    const parts = normalized.slice(4).split(".");
    if (parts.length !== 2) throw new Error("Malformed agent API key");
    const [payload, signature] = parts;
    if (!payload || !signature) throw new Error("Malformed agent API key");
    const expected = signPayload(payload);
    if (!safeEqual(signature, expected)) throw new Error("Invalid agent API key signature");
    const decoded = JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
    return normalizeClaims(decoded);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("api key")) throw error;
    throw new Error("Invalid agent API key");
  }
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const parts = header.split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new Error("Authorization bearer token required");
  }
  const value = parts[1];
  return value;
}
