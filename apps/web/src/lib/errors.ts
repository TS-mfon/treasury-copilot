/**
 * Shared error handling helpers.
 *
 * Additive: the legacy `friendlyError()` helper is preserved so existing UI
 * and route callers keep working.  The new additions below are opt-in via
 * `AppError` subclasses and `toApiError()`.
 */

export interface ApiErrorShape {
  error: string;
  status: number;
  details?: string;
}

const ERROR_MESSAGE_KEYS = [
  "shortMessage",
  "message",
  "details",
  "reason",
  "error",
  "cause",
  "data",
] as const;

export function errorMessage(error: unknown): string {
  const seen = new WeakSet<object>();

  function visit(value: unknown, depth: number): string | undefined {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      return String(value);
    }
    if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return undefined;
    seen.add(value);

    for (const key of ERROR_MESSAGE_KEYS) {
      const candidate = visit((value as Record<string, unknown>)[key], depth + 1);
      if (candidate) return candidate;
    }

    const code = (value as Record<string, unknown>).code;
    if (typeof code === "string" || typeof code === "number") return `Wallet RPC error ${code}`;
    return undefined;
  }

  return visit(error, 0) ?? "Unknown wallet or network error";
}

/**
 * Legacy hook: maps raw wallet/network/policy errors to safe UI strings.
 */
export function friendlyError(error: unknown) {
  const raw = errorMessage(error);
  const message = raw.toLowerCase();

  if (message.includes("user rejected") || message.includes("user denied")) {
    return "The wallet request was rejected. No changes were made.";
  }
  if (
    message.includes("erc-7715") ||
    message.includes("execution permissions") ||
    message.includes("wallet_requestexecutionpermissions") ||
    message.includes("wallet_getsupportedexecutionpermissions") ||
    message.includes("corresponding handler") ||
    message.includes("requestexecutionpermissions")
  ) {
    return "This wallet does not support ERC-7715 execution permissions on the selected chain. Use MetaMask with advanced permissions support, switch chains, or try a wallet that exposes wallet_requestExecutionPermissions.";
  }
  if (message.includes("metamask") || message.includes("ethereum")) {
    return "MetaMask is not available or could not complete the request.";
  }
  if (message.includes("missing usdc address")) {
    return "This chain is missing its USDC configuration. Pick another chain or configure the token address.";
  }
  if (
    message.includes("okb is not configured") ||
    message.includes("usdc is not configured")
  ) {
    return "This chain is missing the selected token configuration. Add the verified token address and decimals before delegating.";
  }
  if (message.includes("policy not allowed")) {
    return "This policy is not enabled for execution by the relay.";
  }
  if (message.includes("missing 1shot credentials")) {
    return "The payout executor is not configured yet. The request was not executed.";
  }
  if (message.includes("fetch failed") || message.includes("network")) {
    return "The network request failed. Check the connection and try again.";
  }
  if (message.includes("duplicate")) {
    return "This payload was already submitted. Change the request details before trying again.";
  }
  if (message.includes("unauthorized")) {
    return "The configured signer is not authorized for this policy.";
  }
  if (message.includes("balance too low") || message.includes("insufficient")) {
    return "The delegated wallet does not have enough token balance or native gas for this step. Add funds, then try again.";
  }

  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

function apiCode(message: string) {
  const value = message.toLowerCase();
  if (value.includes("agent") && value.includes("match")) return ["agent_mismatch", 403] as const;
  if (value.includes("bearer") || value.includes("api key")) return ["invalid_api_key", 401] as const;
  if (value.includes("idempotency")) return ["idempotency_conflict", 409] as const;
  if (value.includes("amount") || value.includes("decimal")) return ["invalid_amount", 422] as const;
  if (value.includes("insufficient") || value.includes("balance")) return ["insufficient_balance", 422] as const;
  if (value.includes("undetermined") || value.includes("validator") || value.includes("consensus")) return ["genlayer_undetermined", 503] as const;
  if (value.includes("execution permissions") || value.includes("erc-7715") || value.includes("requestexecutionpermissions")) {
    return ["unsupported_wallet_capability", 422] as const;
  }
  if (value.includes("unsupported") && value.includes("chain")) return ["unsupported_chain", 422] as const;
  if (value.includes("delegation")) return ["delegation_unavailable", 422] as const;
  if (value.includes("policy") && value.includes("den")) return ["policy_denied", 422] as const;
  if (value.includes("unauthorized") || value.includes("authentication") || value.includes("session")) return ["unauthorized", 401] as const;
  return ["request_failed", 400] as const;
}

export function apiErrorResponse(error: unknown, requestId?: string) {
  const message = friendlyError(error);
  const [code, status] = apiCode(message);
  return Response.json({
    error: code,
    message,
    fields: {},
    ...(requestId ? { request_id: requestId } : {}),
    retryable: status >= 500,
  }, { status });
}

/* -------------------------------------------------------------------------- */

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = HTTP_STATUS.BAD_REQUEST,
    public readonly details?: string
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toApiError(): ApiErrorShape {
    const base: ApiErrorShape = { error: this.message, status: this.status };
    if (process.env.NODE_ENV !== "production" && this.details) {
      base.details = this.details;
    }
    return base;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: string) {
    super(message, HTTP_STATUS.BAD_REQUEST, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details?: string) {
    super(message, HTTP_STATUS.UNAUTHORIZED, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: string) {
    super(message, HTTP_STATUS.FORBIDDEN, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: string) {
    super(message, HTTP_STATUS.NOT_FOUND, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: string) {
    super(message, HTTP_STATUS.CONFLICT, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation error", details?: string) {
    super(message, HTTP_STATUS.UNPROCESSABLE, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Rate limit exceeded", details?: string) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, details);
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal Server Error", details?: string) {
    super(message, HTTP_STATUS.INTERNAL, details);
  }
}

export function requestFailed(message: string, details?: string) {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, details);
}

export function badRequest(message = "Bad request", details?: string) {
  return new BadRequestError(message, details);
}

export function notFound(message = "Not found", details?: string) {
  return new NotFoundError(message, details);
}

export function unauthorized(message = "Unauthorized", details?: string) {
  return new UnauthorizedError(message, details);
}

export function forbidden(message = "Forbidden", details?: string) {
  return new ForbiddenError(message, details);
}

export function conflict(message = "Conflict", details?: string) {
  return new ConflictError(message, details);
}

export function unprocessable(message = "Validation error", details?: string) {
  return new ValidationError(message, details);
}

export function rateLimited(message = "Rate limit exceeded", details?: string) {
  return new TooManyRequestsError(message, details);
}

export function internalServerError(
  message = "Internal server error",
  details?: string
) {
  return new InternalError(message, details);
}

export function toApiResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(error.toApiError(), { status: error.status });
  }

  const message =
    error instanceof Error ? error.message : "Unknown error";
  const payload: ApiErrorShape = {
    error: process.env.NODE_ENV === "production" ? "Internal server error" : message,
    status: HTTP_STATUS.INTERNAL,
  };

  if (process.env.NODE_ENV !== "production" && error instanceof Error && error.stack) {
    payload.details = error.stack.split("\n").slice(0, 6).join("\n");
  }

  return Response.json(payload, { status: HTTP_STATUS.INTERNAL });
}

export function withApiErrorHandling<T extends (...args: Parameters<T>) => Promise<Response>>(
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      return toApiResponse(error);
    }
  }) as T;
}

export interface MachineReadableApiError extends ApiErrorShape {
  machine_readable_error: true;
  client_message: string;
  fields: string[];
  request_id?: string;
  retry_after_ms?: number;
}

export function machineError(opts: {
  status: number;
  clientMessage: string;
  innerError?: string;
  fields?: string[];
  requestId?: string;
  retryAfterMs?: number;
}) {
  const payload: MachineReadableApiError = {
    machine_readable_error: true,
    status: opts.status,
    error: opts.clientMessage,
    client_message: opts.clientMessage,
    fields: Array.from(new Set(opts.fields ?? [])),
    ...(opts.requestId && { request_id: opts.requestId }),
    ...(opts.retryAfterMs && { retry_after_ms: opts.retryAfterMs }),
  };
  if (process.env.NODE_ENV !== "production" && opts.innerError) {
    payload.details = String(opts.innerError).slice(0, 512);
  }
  return { payload, status: opts.status };
}

export function responseFrom(opts: Parameters<typeof machineError>[0]) {
  const { status, ...rest } = machineError(opts);
  return Response.json(rest, { status });
}

export function isMachineError(value: unknown): value is MachineReadableApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).machine_readable_error === true &&
    typeof (value as Record<string, unknown>).client_message === "string"
  );
}
