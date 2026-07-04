export interface GenLayerRequest {
  method: string;
  params?: unknown[];
}

const rpcUrl = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL;

export async function genlayerRpc<T>(request: GenLayerRequest): Promise<T> {
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_GENLAYER_RPC_URL is not configured");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: request.method,
      params: request.params ?? [],
    }),
  });
  const data = await response.json().catch(() => {
    throw new Error("GenLayer returned an unreadable response");
  });
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result as T;
}

export async function readPolicy(policyAddress: string) {
  return genlayerRpc<Record<string, unknown>>({
    method: "gen_call",
    params: [{ to: policyAddress, method: "get_policy", args: [] }],
  });
}

export async function listRequests(policyAddress: string) {
  return genlayerRpc<string[]>({
    method: "gen_call",
    params: [{ to: policyAddress, method: "list_requests", args: [] }],
  });
}

export async function getRequest(policyAddress: string, requestId: string) {
  return genlayerRpc<Record<string, string>>({
    method: "gen_call",
    params: [{ to: policyAddress, method: "get_request", args: [requestId] }],
  });
}

export async function writePolicyMethod(policyAddress: string, method: string, args: unknown[]) {
  return genlayerRpc<Record<string, unknown>>({
    method: "gen_write",
    params: [{ to: policyAddress, method, args }],
  });
}
