/**
 * Validated server-side environment access.
 *
 * All build-time and critical runtime secrets should flow through here so
 * callers do not scatter process.env reads around the app.  Fail-fast by
 * throwing during initialization when a required secret is missing.
 */

let _initialized = false;
let validatePromise: Promise<ResolvedEnv> | null = null;

const REQUIRED_SECRETS = [
  "OWNER_SESSION_SECRET",
  "AGENT_API_KEY_SECRET",
] as const;

const REQUIRED_VARS = [
  "GENLAYER_REGISTRY",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function requireSecret(name: string, minLength = 24): string {
  const value = requireEnv(name);
  if (value.length < minLength) {
    throw new Error(
      `Environment variable ${name} must be at least ${minLength} characters (current: ${value.length})`
    );
  }
  return value;
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function secret(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;
  return value.trim();
}

function csvSet(name: string, fallback = ""): Set<string> {
  const raw = process.env[name] ?? fallback;
  if (!raw.trim()) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
  );
}

interface ResolvedEnv {
  ownerSessionSecret: string;
  agentApiKeySecret: string;
  jwtSigningSecret: string | undefined;
  genlayerRegistry: string;
  agentSignerPrivateKey: string | undefined;
  oneShotRelayerUrl: string | undefined;
  corsOrigin: string;
  cronSecret: string | undefined;
  nodeEnv: string;
  port: number;
  isProduction: boolean;
  allowedGenlayerPolicyAddresses: Set<string>;
  allowedEvmChainIds: Set<string>;
}

let _env: ResolvedEnv | undefined;

export function resolveEnv(): ResolvedEnv {
  return env();
}

export function env(): ResolvedEnv {
  if (!_env) {
    _env = resolveRuntimeEnv();
  }
  return _env;
}

function resolveRuntimeEnv(): ResolvedEnv {
  const ownerSessionSecret = requireSecret("OWNER_SESSION_SECRET");
  const agentApiKeySecret = requireSecret("AGENT_API_KEY_SECRET");
  const genlayerRegistry = requireEnv("GENLAYER_REGISTRY");
  const oneShotRelayerUrl =
    secret("ONE_SHOT_RELAYER_URL") ?? secret("NEXT_PUBLIC_ONE_SHOT_RELAYER_URL");
  const resolved: ResolvedEnv = {
    ownerSessionSecret,
    agentApiKeySecret,
    jwtSigningSecret: secret("JWT_SIGNING_SECRET"),
    genlayerRegistry,
    agentSignerPrivateKey: secret("AGENT_SIGNER_PRIVATE_KEY"),
    oneShotRelayerUrl,
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    cronSecret: secret("CRON_SECRET"),
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? "8787"),
    isProduction: boolEnv("NODE_ENV", false),
    allowedGenlayerPolicyAddresses: csvSet(
      "ALLOWED_GENLAYER_POLICY_ADDRESSES",
      ""
    ),
    allowedEvmChainIds: csvSet("ALLOWED_EVM_CHAIN_IDS", "84532,421614"),
  };
  if (!resolved.oneShotRelayerUrl) {
    throw new Error("ONE_SHOT_RELAYER_URL is not configured");
  }
  return resolved;
}

export { boolEnv, csvSet, requireEnv, requireSecret, secret };
