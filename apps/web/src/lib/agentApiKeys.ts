/**
 * Agent API key lifecycle helpers.
 *
 * Additive domain layer on top of `apiAuth.ts`.  Handles metadata parsing,
 * key validation, rotation, and revocation signposting without re-implementing
 * signing primitives.
 */

import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import {
  AGENT_API_KEY_TTL_SECONDS,
  issueAgentApiKey,
  type AgentApiKeyClaims,
} from "@/lib/apiAuth";

export interface AgentKeyMetadata {
  keyId: string;
  keyVersion: number;
  issuedAt: number;
  expiresAt?: number;
  owner: Address;
  agent: Address;
  policy: Address;
  delegatedAccount: Address;
  chainId: number;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
}

export function parseAgentKeyMetadata(claims: AgentApiKeyClaims): AgentKeyMetadata {
  return {
    keyId: claims.keyId,
    keyVersion: claims.keyVersion,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    owner: claims.owner,
    agent: claims.agent,
    policy: claims.policy,
    delegatedAccount: claims.delegatedAccount,
    chainId: claims.chainId,
    token: claims.token,
    tokenSymbol: claims.tokenSymbol,
    tokenDecimals: claims.tokenDecimals,
  };
}

export function keyMatchesClaims(
  claims: AgentApiKeyClaims,
  expected: Omit<AgentKeyMetadata, "keyId" | "keyVersion" | "issuedAt">
): boolean {
  const metadata = parseAgentKeyMetadata(claims);

  return (
    metadata.owner.toLowerCase() === expected.owner.toLowerCase() &&
    metadata.agent.toLowerCase() === expected.agent.toLowerCase() &&
    metadata.policy.toLowerCase() === expected.policy.toLowerCase() &&
    metadata.delegatedAccount.toLowerCase() === expected.delegatedAccount.toLowerCase() &&
    metadata.chainId === expected.chainId &&
    metadata.token.toLowerCase() === expected.token.toLowerCase() &&
    metadata.tokenSymbol === expected.tokenSymbol &&
    metadata.tokenDecimals === expected.tokenDecimals
  );
}

export interface RotateAgentKeyOptions {
  owner: Address;
  agent: Address;
  policy: Address;
  delegatedAccount: Address;
  chainId: number;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  prevVersion: number;
  expiresInSeconds?: number;
}

export interface RotateAgentKeyResult {
  agent_api_key: string;
  key_version: number;
  key_id: string;
}

export function rotateAgentKey(options: RotateAgentKeyOptions): RotateAgentKeyResult {
  const nextVersion = options.prevVersion + 1;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (options.expiresInSeconds ?? AGENT_API_KEY_TTL_SECONDS);

  const keyId = randomUUID();
  const agent_api_key = issueAgentApiKey({
    keyId,
    keyVersion: nextVersion,
    owner: options.owner,
    agent: options.agent,
    policy: options.policy,
    delegatedAccount: options.delegatedAccount,
    chainId: options.chainId,
    token: options.token,
    tokenSymbol: options.tokenSymbol,
    tokenDecimals: options.tokenDecimals,
    issuedAt,
    expiresAt,
  });

  return { agent_api_key, key_version: nextVersion, key_id: keyId };
}

export function isAgentKeyExpired(claims: AgentApiKeyClaims): boolean {
  if (claims.expiresAt !== undefined) {
    return claims.expiresAt < Math.floor(Date.now() / 1000);
  }
  return false;
}
