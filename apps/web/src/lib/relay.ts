export async function executeApprovedRequest(relayPayload: unknown) {
  const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL?.replace(/\/$/, "") ?? "";
  const endpoint = relayUrl ? `${relayUrl}/execute-approved-request` : "/api/execute-approved-request";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(relayPayload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "1Shot relay failed");
  return data as {
    tx_hash: string;
    genlayer_record_execution: {
      method: "record_execution";
      args: [string, string];
    };
  };
}
