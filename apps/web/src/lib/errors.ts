export function friendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const message = raw.toLowerCase();

  if (message.includes("user rejected") || message.includes("user denied")) {
    return "The wallet request was rejected. No changes were made.";
  }
  if (message.includes("metamask") || message.includes("ethereum")) {
    return "MetaMask is not available or could not complete the request.";
  }
  if (message.includes("missing usdc address")) {
    return "This chain is missing its USDC configuration. Pick another chain or configure the token address.";
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

  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}
