import { createServer } from "node:http";
import { isAddress, isHex } from "viem";

interface ExecuteBody {
  policy: string;
  method_id: string;
  chain_id: string;
  delegated_account?: string;
  token?: string;
  delegation?: string;
  permission_context?: string;
  params: {
    requestId: string;
    from?: string;
    token?: string;
    recipient: string;
    amount: string;
  };
}

const port = Number(process.env.PORT ?? 8787);
const oneShotRelayerUrl = process.env.ONE_SHOT_RELAYER_URL
  ?? process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
  ?? "https://relayer.1shotapi.dev/relayers";
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
  if (body.delegated_account !== undefined && !isAddress(body.delegated_account)) throw new Error("invalid delegated account");
  if (body.token !== undefined && !isAddress(body.token)) throw new Error("invalid token address");
  if (body.permission_context !== undefined && !isHex(body.permission_context, { strict: true })) {
    throw new Error("invalid permission context");
  }
  if (body.delegation !== undefined && body.delegation !== "metamask-smart-account-payout") {
    throw new Error("unsupported delegation type");
  }
  if (!body.params || typeof body.params !== "object") throw new Error("invalid params");
  if (!isHex(body.params.requestId, { strict: true }) || body.params.requestId.length !== 66) {
    throw new Error("invalid request id");
  }
  if (body.params.from !== undefined && !isAddress(body.params.from)) throw new Error("invalid params delegated account");
  if (body.params.token !== undefined && !isAddress(body.params.token)) throw new Error("invalid params token");
  if (body.delegated_account && body.params.from && body.delegated_account.toLowerCase() !== body.params.from.toLowerCase()) {
    throw new Error("delegated account mismatch");
  }
  if (body.token && body.params.token && body.token.toLowerCase() !== body.params.token.toLowerCase()) {
    throw new Error("token mismatch");
  }
  if (!isAddress(body.params.recipient)) throw new Error("invalid recipient");
  if (!/^[1-9][0-9]*$/.test(body.params.amount)) throw new Error("invalid amount");
  return body;
}

async function executeOneShot(body: ExecuteBody) {
  const response = await fetch(oneShotRelayerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policy: body.policy,
      method_id: body.method_id,
      chain_id: body.chain_id,
      delegated_account: body.delegated_account,
      token: body.token,
      delegation: body.delegation,
      permission_context: body.permission_context,
      params: {
        ...body.params,
        chain_id: body.chain_id,
        delegated_account: body.delegated_account,
        permission_context: body.permission_context,
      },
    }),
  });

  const data = await response.json().catch(async () => ({ raw: await response.text() })) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`1Shot relayer failed: ${response.status} ${JSON.stringify(data).slice(0, 240)}`);
  }

  const txHash = String(data.tx_hash ?? data.txHash ?? data.hash ?? "");
  if (!isHex(txHash, { strict: true })) {
    throw new Error(`1Shot relayer response missing tx hash: ${JSON.stringify(data).slice(0, 240)}`);
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
