import { createServer } from "node:http";
import { isAddress, isHex } from "viem";

interface ExecuteBody {
  policy: string;
  method_id: string;
  chain_id: string;
  treasury?: string;
  delegation?: string;
  params: {
    requestId: string;
    treasury?: string;
    recipient: string;
    amount: string;
  };
}

const port = Number(process.env.PORT ?? 8787);
const oneShotBaseUrl = process.env.ONE_SHOT_BASE_URL ?? "https://api.1shotapi.com";
const allowedPolicies = csvSet(process.env.ALLOWED_GENLAYER_POLICY_ADDRESSES);
const allowedChainIds = csvSet(process.env.ALLOWED_EVM_CHAIN_IDS ?? "84532,421614");

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function json(status: number, payload: unknown) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
    body: JSON.stringify(payload),
  };
}

async function readJson(req: NodeJS.ReadableStream): Promise<unknown> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (body.length > 32_768) throw new Error("body too large");
  return JSON.parse(body || "{}");
}

function assertExecuteBody(value: unknown): ExecuteBody {
  const body = value as ExecuteBody;
  if (!body || typeof body !== "object") throw new Error("invalid body");
  if (!isAddress(body.policy)) throw new Error("invalid policy address");
  if (!body.method_id || typeof body.method_id !== "string") throw new Error("invalid 1Shot method id");
  if (!allowedPolicies.has(body.policy.toLowerCase())) throw new Error("policy not allowed");
  if (!allowedChainIds.has(String(body.chain_id))) throw new Error("chain not allowed");
  if (body.treasury !== undefined && !isAddress(body.treasury)) throw new Error("invalid treasury address");
  if (body.delegation !== undefined && body.delegation !== "metamask-smart-account-payout") {
    throw new Error("unsupported delegation type");
  }
  if (!body.params || typeof body.params !== "object") throw new Error("invalid params");
  if (!isHex(body.params.requestId, { strict: true }) || body.params.requestId.length !== 66) {
    throw new Error("invalid request id");
  }
  if (body.params.treasury !== undefined && !isAddress(body.params.treasury)) throw new Error("invalid params treasury");
  if (body.treasury && body.params.treasury && body.treasury.toLowerCase() !== body.params.treasury.toLowerCase()) {
    throw new Error("treasury mismatch");
  }
  if (!isAddress(body.params.recipient)) throw new Error("invalid recipient");
  if (!/^[1-9][0-9]*$/.test(body.params.amount)) throw new Error("invalid amount");
  return body;
}

async function getBearerToken(): Promise<string> {
  const clientId = process.env.ONE_SHOT_CLIENT_ID;
  const clientSecret = process.env.ONE_SHOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("missing 1Shot credentials");

  const response = await fetch(`${oneShotBaseUrl}/v0/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`1Shot token failed: ${response.status} ${text.slice(0, 240)}`);
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("1Shot token missing access_token");
  return data.access_token;
}

async function executeOneShot(body: ExecuteBody) {
  const token = await getBearerToken();
  const response = await fetch(`${oneShotBaseUrl}/v0/methods/${encodeURIComponent(body.method_id)}/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ params: body.params }),
  });

  const data = await response.json().catch(async () => ({ raw: await response.text() })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`1Shot execute failed: ${response.status} ${JSON.stringify(data).slice(0, 240)}`);
  }

  const txHash = String(data.tx_hash ?? data.txHash ?? data.hash ?? "");
  if (!isHex(txHash, { strict: true })) {
    throw new Error(`1Shot response missing tx hash: ${JSON.stringify(data).slice(0, 240)}`);
  }

  return {
    tx_hash: txHash,
    raw: data,
    genlayer_record_execution: {
      method: "record_execution",
      args: [body.params.requestId, txHash],
    },
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const response = json(204, {});
    res.writeHead(response.status, response.headers);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/execute-approved-request") {
    const response = json(404, { error: "not found" });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  try {
    const body = assertExecuteBody(await readJson(req));
    const result = await executeOneShot(body);
    const response = json(200, result);
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  } catch (error) {
    const response = json(400, { error: error instanceof Error ? error.message : "unknown error" });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  }
});

server.listen(port, () => {
  console.log(`Treasury Copilot relay listening on :${port}`);
});
