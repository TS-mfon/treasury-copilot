import { createHash, randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Db, type UpdateFilter } from "mongodb";
import type { AgentApiKeyClaims } from "@/lib/apiAuth";
import type { RequestState } from "@/lib/apiServer";
import { requireOwnerSession } from "@/lib/ownerSession";

export type PilotEventType =
  | "request.accepted"
  | "request.rejected"
  | "review.started"
  | "review.finalized"
  | "owner.approval_required"
  | "execution.submitted"
  | "execution.confirmed"
  | "execution.failed"
  | "request.reconciled"
  | "request.feedback";

export type PilotRequestDocument = {
  request_id: string;
  correlation_id: string;
  policy: string;
  owner: string;
  agent: string;
  key_id: string;
  environment: "testnet";
  chain_id: number;
  token: string;
  token_symbol: string;
  recipient: string;
  amount: string;
  amount_units: string;
  category: string;
  verdict: string;
  status: string;
  execution_status: string;
  reasoning: string;
  tx_hash: string;
  execution_error: string;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
  reconciliation_status: "unknown" | "verified" | "stale" | "conflict" | "unresolved";
};

export type PilotEventDocument = {
  event_id: string;
  event_key: string;
  event_type: PilotEventType;
  request_id?: string;
  correlation_id: string;
  policy?: string;
  owner?: string;
  agent?: string;
  environment: "testnet";
  status?: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
};

type RateLimitDocument = {
  key: string;
  window_start: number;
  count: number;
  expires_at: Date;
};

type FeedbackDocument = {
  feedback_id: string;
  request_id?: string;
  correlation_id?: string;
  tester?: string;
  category: string;
  severity: "low" | "medium" | "high";
  description: string;
  created_at: string;
};

type PilotCollections = {
  requests: Collection<PilotRequestDocument>;
  events: Collection<PilotEventDocument>;
  rateLimits: Collection<RateLimitDocument>;
  feedback: Collection<FeedbackDocument>;
};

declare global {
  var __treasuryCopilotMongoClientPromise: Promise<MongoClient> | undefined;
  var __treasuryCopilotPilotIndexes: Promise<void> | undefined;
}

function mongoUri() {
  return process.env.MONGODB_URI?.trim() ?? "";
}

export function pilotStoreConfigured() {
  return Boolean(mongoUri());
}

export async function pilotStoreHealth() {
  if (!pilotStoreConfigured()) return "missing" as const;
  try {
    const db = await database();
    await db?.command({ ping: 1 });
    return "healthy" as const;
  } catch {
    return "unavailable" as const;
  }
}

async function database(): Promise<Db | null> {
  const uri = mongoUri();
  if (!uri) return null;
  const clientPromise = globalThis.__treasuryCopilotMongoClientPromise ??= new MongoClient(uri, {
    appName: "treasury-copilot-pilot",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 3500,
  }).connect();
  return (await clientPromise).db(process.env.MONGODB_DB?.trim() || "treasury_copilot");
}

async function collections(): Promise<PilotCollections | null> {
  const db = await database();
  if (!db) return null;
  globalThis.__treasuryCopilotPilotIndexes ??= (async () => {
    await Promise.all([
      db.collection<PilotRequestDocument>("pilot_requests").createIndexes([
        { key: { request_id: 1 }, unique: true },
        { key: { correlation_id: 1 } },
        { key: { created_at: -1 } },
        { key: { owner: 1, created_at: -1 } },
      ]),
      db.collection<PilotEventDocument>("pilot_events").createIndexes([
        { key: { event_key: 1 }, unique: true },
        { key: { request_id: 1, created_at: -1 } },
        { key: { created_at: -1 } },
      ]),
      db.collection<RateLimitDocument>("pilot_rate_limits").createIndexes([
        { key: { key: 1, window_start: 1 }, unique: true },
        { key: { expires_at: 1 }, expireAfterSeconds: 0 },
      ]),
      db.collection<FeedbackDocument>("pilot_feedback").createIndexes([
        { key: { created_at: -1 } },
        { key: { request_id: 1 } },
      ]),
    ]);
  })();
  await globalThis.__treasuryCopilotPilotIndexes;
  return {
    requests: db.collection<PilotRequestDocument>("pilot_requests"),
    events: db.collection<PilotEventDocument>("pilot_events"),
    rateLimits: db.collection<RateLimitDocument>("pilot_rate_limits"),
    feedback: db.collection<FeedbackDocument>("pilot_feedback"),
  };
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function correlationId(request: Request) {
  const supplied = request.headers.get("x-correlation-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:]{8,96}$/.test(supplied) ? supplied : `corr_${randomUUID()}`;
}

export function withCorrelation(response: Response, id: string) {
  const headers = new Headers(response.headers);
  headers.set("x-correlation-id", id);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function safePilotError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Unknown pilot error";
}

function eventForRequest(request: PilotRequestDocument): PilotEventType | null {
  if (request.execution_status === "executed" || Boolean(request.tx_hash)) return "execution.confirmed";
  if (request.execution_status === "failed") return "execution.failed";
  if (request.verdict === "approved") return "review.finalized";
  if (request.verdict === "denied") return "review.finalized";
  if (["reviewing", "review_pending"].includes(request.execution_status)) return "review.started";
  return null;
}

function eventKey(eventType: PilotEventType, request: PilotRequestDocument) {
  return `${eventType}:${request.request_id}:${request.status}:${request.execution_status}:${request.tx_hash}`;
}

export function pilotRequestFromState(input: {
  claims: AgentApiKeyClaims;
  request: RequestState & Record<string, unknown>;
  correlationId: string;
}) : PilotRequestDocument {
  const request = input.request;
  return {
    request_id: String(request.request_id),
    correlation_id: input.correlationId,
    policy: input.claims.policy.toLowerCase(),
    owner: input.claims.owner.toLowerCase(),
    agent: input.claims.agent.toLowerCase(),
    key_id: input.claims.keyId,
    environment: "testnet",
    chain_id: input.claims.chainId,
    token: input.claims.token.toLowerCase(),
    token_symbol: input.claims.tokenSymbol,
    recipient: String(request.recipient ?? "").toLowerCase(),
    amount: String(request.amount ?? ""),
    amount_units: String(request.amount_atto ?? request.amount_units ?? ""),
    category: String(request.category ?? ""),
    verdict: String(request.verdict ?? "pending"),
    status: String(request.status ?? request.execution_status ?? "submitted"),
    execution_status: String(request.execution_status ?? "submitted"),
    reasoning: String(request.reasoning ?? ""),
    tx_hash: String(request.tx_hash ?? ""),
    execution_error: String(request.execution_error ?? ""),
    created_at: String(request.created_at ?? new Date().toISOString()),
    updated_at: String(request.updated_at ?? request.created_at ?? new Date().toISOString()),
    last_observed_at: new Date().toISOString(),
    reconciliation_status: "unknown",
  };
}

export async function recordPilotRequest(document: PilotRequestDocument, eventType?: PilotEventType) {
  const store = await collections();
  if (!store) return;
  await store.requests.updateOne(
    { request_id: document.request_id },
    { $set: document } as UpdateFilter<PilotRequestDocument>,
    { upsert: true },
  );
  const type = eventType ?? eventForRequest(document);
  if (type) await recordPilotEvent(type, document);
}

export async function recordPilotRequestSafely(document: PilotRequestDocument, eventType?: PilotEventType) {
  try {
    await recordPilotRequest(document, eventType);
  } catch (error) {
    console.error("Pilot request projection failed", {
      requestId: document.request_id,
      correlationId: document.correlation_id,
      error: safePilotError(error),
    });
  }
}

export async function recordPilotEvent(eventType: PilotEventType, request: PilotRequestDocument, metadata: Record<string, string | number | boolean | null> = {}) {
  const store = await collections();
  if (!store) return;
  const event: PilotEventDocument = {
    event_id: randomUUID(),
    event_key: eventKey(eventType, request),
    event_type: eventType,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    policy: request.policy,
    owner: request.owner,
    agent: request.agent,
    environment: "testnet",
    status: request.execution_status,
    metadata,
    created_at: new Date().toISOString(),
  };
  await store.events.updateOne({ event_key: event.event_key }, { $setOnInsert: event }, { upsert: true });
}

export async function recordPilotRejection(input: {
  correlationId: string;
  owner?: string;
  agent?: string;
  policy?: string;
  error: string;
}) {
  const store = await collections();
  if (!store) return;
  await store.events.insertOne({
    event_id: randomUUID(),
    event_key: `rejection:${input.correlationId}`,
    event_type: "request.rejected",
    correlation_id: input.correlationId,
    owner: input.owner,
    agent: input.agent,
    policy: input.policy,
    environment: "testnet",
    metadata: { error: input.error.slice(0, 240) },
    created_at: new Date().toISOString(),
  }).catch(() => undefined);
}

export async function consumePilotRateLimit(input: { identifier: string; limit: number; windowSeconds: number }) {
  const store = await collections();
  if (!store) return { allowed: true, count: 0, limit: input.limit, retryAfter: 0 };
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / input.windowSeconds) * input.windowSeconds;
  const key = fingerprint(input.identifier);
  const document = await store.rateLimits.findOneAndUpdate(
    { key, window_start: windowStart },
    {
      $inc: { count: 1 },
      $setOnInsert: { key, window_start: windowStart, expires_at: new Date((windowStart + input.windowSeconds + 60) * 1000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  const count = document?.count ?? input.limit + 1;
  return {
    allowed: count <= input.limit,
    count,
    limit: input.limit,
    retryAfter: Math.max(windowStart + input.windowSeconds - now, 1),
  };
}

export async function listPilotRequests(filters: { limit: number; owner?: string; status?: string; cursor?: string }) {
  const store = await collections();
  if (!store) return { requests: [], next_cursor: null };
  const query: Record<string, unknown> = {};
  if (filters.owner) query.owner = filters.owner.toLowerCase();
  if (filters.status) query.execution_status = filters.status;
  if (filters.cursor) query.created_at = { $lt: filters.cursor };
  const rows = await store.requests.find(query).sort({ created_at: -1 }).limit(filters.limit + 1).toArray();
  const hasMore = rows.length > filters.limit;
  const requests = rows.slice(0, filters.limit);
  return { requests, next_cursor: hasMore ? requests.at(-1)?.created_at ?? null : null };
}

export async function listPilotEvents(limit: number, cursor?: string) {
  const store = await collections();
  if (!store) return { events: [], next_cursor: null };
  const query = cursor ? { created_at: { $lt: cursor } } : {};
  const rows = await store.events.find(query).sort({ created_at: -1 }).limit(limit + 1).toArray();
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit);
  return { events, next_cursor: hasMore ? events.at(-1)?.created_at ?? null : null };
}

export async function pilotOverview() {
  const store = await collections();
  if (!store) return { configured: false, requests: 0, events: 0, active_agents: 0, active_owners: 0, executed: 0, approved: 0, denied: 0, pending: 0, failed: 0 };
  const [requests, events, activeAgents, activeOwners, executed, approved, denied, pending, failed] = await Promise.all([
    store.requests.countDocuments(),
    store.events.countDocuments(),
    store.requests.distinct("agent"),
    store.requests.distinct("owner"),
    store.requests.countDocuments({ execution_status: "executed" }),
    store.requests.countDocuments({ verdict: "approved" }),
    store.requests.countDocuments({ verdict: "denied" }),
    store.requests.countDocuments({ verdict: "pending" }),
    store.requests.countDocuments({ execution_status: "failed" }),
  ]);
  return { configured: true, requests, events, active_agents: activeAgents.length, active_owners: activeOwners.length, executed, approved, denied, pending, failed };
}

export async function recordPilotFeedback(input: Omit<FeedbackDocument, "feedback_id" | "created_at">) {
  const store = await collections();
  if (!store) return { stored: false };
  await store.feedback.insertOne({ ...input, feedback_id: randomUUID(), created_at: new Date().toISOString() });
  return { stored: true };
}

export async function requirePilotAdmin() {
  const owner = await requireOwnerSession();
  const allowlist = (process.env.ADMIN_WALLET_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(owner.toLowerCase())) {
    throw new Error("Pilot operations access is not enabled for this owner");
  }
  return owner;
}
