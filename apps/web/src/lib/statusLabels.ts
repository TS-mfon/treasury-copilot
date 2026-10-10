/**
 * Human-readable request status.
 *
 * The raw on-chain values are precise but not self-explanatory: `not_applicable` is what the policy
 * stores when a denial means execution never applies, which reads as "unknown" rather than
 * "denied". These labels say what happened to the money.
 */
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  reviewing: "Under review",
  review_pending: "Awaiting review",
  pending: "Under review",
  approved: "Approved",
  ready: "Approved, queued",
  executing: "Paying",
  bridging: "Bridging to destination",
  executed: "Accepted / Executed",
  denied: "Denied",
  // A denial is why execution never applied, so report the denial rather than the side effect.
  not_applicable: "Denied",
  failed: "Failed, will retry",
  no_record: "No record",
};

export type StatusTone = "success" | "danger" | "pending" | "neutral";

const STATUS_TONES: Record<string, StatusTone> = {
  executed: "success",
  approved: "success",
  ready: "success",
  denied: "danger",
  not_applicable: "danger",
  failed: "danger",
  executing: "pending",
  bridging: "pending",
  submitted: "pending",
  reviewing: "pending",
  review_pending: "pending",
  pending: "pending",
};

/** Label for a status, falling back to a readable form of an unrecognised value. */
export function statusLabel(value: string | undefined | null): string {
  if (!value) return "Unknown";
  return STATUS_LABELS[value] ?? value.replaceAll("_", " ");
}

export function statusTone(value: string | undefined | null): StatusTone {
  if (!value) return "neutral";
  return STATUS_TONES[value] ?? "neutral";
}

/** Tailwind text colour for a status tone. */
export function statusToneClass(value: string | undefined | null): string {
  switch (statusTone(value)) {
    case "success": return "text-success";
    case "danger": return "text-danger";
    case "pending": return "text-signal";
    default: return "text-neutral-400";
  }
}

/**
 * Whether a status is terminal.
 *
 * Useful for a poller: a terminal request will never change again, so continuing to poll it is
 * wasted work.
 */
export function isTerminalStatus(value: string | undefined | null): boolean {
  return value === "executed" || value === "denied" || value === "not_applicable";
}

/**
 * What the transaction column should say when there is no transaction hash.
 *
 * A denied request has no hash and never will, so showing "Pending" described it as waiting for a
 * settlement that was already refused. The two cases are genuinely different: "Rejected" means
 * nothing was sent and nothing will be, "Pending" means a hash is still expected.
 */
export function missingTxLabel(
  status: string | undefined | null,
  verdict?: string | undefined | null,
): "Rejected" | "Pending" {
  if (verdict === "denied") return "Rejected";
  if (status === "denied" || status === "not_applicable") return "Rejected";
  return "Pending";
}

