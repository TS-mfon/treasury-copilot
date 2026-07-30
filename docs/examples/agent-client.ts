const apiBase = process.env.TREASURY_API_BASE
  ?? "https://treasury-copilot-genjury.vercel.app/api/v1";
const apiKey = process.env.TREASURY_API_KEY!;
const agentAddress = process.env.AGENT_ADDRESS!;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(`${body.error}: ${body.message}`);
  }
  return { response, body };
}

const policy = await api("/policy");
const recipient = policy.body.state.whitelisted_recipients[0];
if (!recipient) throw new Error("The owner has not configured an API-discoverable recipient");

const idempotencyKey = "invoice-4471-2026-07";
const queued = await api("/spend", {
  method: "POST",
  body: JSON.stringify({
    agent_address: agentAddress,
    recipient,
    amount: "2.50",
    category: "software_subscription",
    justification: "Monthly build service invoice INV-4471",
    idempotency_key: idempotencyKey,
    evidence: [],
  }),
});

let request = queued.body.request;
while (!["denied", "executed"].includes(request.status)) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const current = await api(`/requests/${queued.body.request_id}`);
  request = current.body.request;
  if (request.status === "failed") {
    console.warn("Execution failed and remains retryable:", request.execution_error);
    break;
  }
}

console.log(request);
