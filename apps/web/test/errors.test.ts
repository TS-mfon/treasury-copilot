import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorResponse } from "../src/lib/errors";

test("API errors return stable machine-readable envelopes", async () => {
  const response = apiErrorResponse(new Error("Request agent does not match API key"), "req-123");
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "agent_mismatch");
  assert.equal(body.request_id, "req-123");
  assert.equal(body.retryable, false);
  assert.deepEqual(body.fields, {});
});
