import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorResponse, errorMessage, friendlyError } from "../src/lib/errors";

test("API errors return stable machine-readable envelopes", async () => {
  const response = apiErrorResponse(new Error("Request agent does not match API key"), "req-123");
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "agent_mismatch");
  assert.equal(body.request_id, "req-123");
  assert.equal(body.retryable, false);
  assert.deepEqual(body.fields, {});
});

test("wallet RPC objects expose their nested message instead of object coercion", () => {
  const error = {
    code: -32601,
    error: {
      message: "wallet_getSupportedExecutionPermissions does not have a corresponding handler",
    },
  };

  assert.equal(
    errorMessage(error),
    "wallet_getSupportedExecutionPermissions does not have a corresponding handler",
  );
  assert.match(friendlyError(error), /does not support ERC-7715/);
});

test("circular provider errors still return a stable fallback", () => {
  const error: Record<string, unknown> = { code: 4200 };
  error.cause = error;
  assert.equal(errorMessage(error), "Wallet RPC error 4200");
});

test("connected MetaMask capability errors are not mislabeled as disconnected", () => {
  assert.match(
    friendlyError(new Error("This wallet does not support MetaMask ERC-7715 execution permissions.")),
    /does not support ERC-7715/,
  );
});
