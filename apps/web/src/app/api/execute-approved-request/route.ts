import { isAddress, isHex } from "viem";

export const runtime = "nodejs";

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

const oneShotRelayerUrl = process.env.ONE_SHOT_RELAYER_URL
  ?? process.env.NEXT_PUBLIC_ONE_SHOT_RELAYER_URL
  ?? "https://relayer.1shotapi.dev/relayers";
const allowedPolicies = csvSet(process.env.ALLOWED_GENLAYER_POLICY_ADDRESSES ?? process.env.NEXT_PUBLIC_GENLAYER_POLICY);
const allowedChainIds = csvSet(process.env.ALLOWED_EVM_CHAIN_IDS ?? "84532,421614");

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
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

export async function POST(request: Request) {
  try {
    const body = assertExecuteBody(await request.json());
    return Response.json(await executeOneShot(body));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown error" }, { status: 400 });
  }
}
