export async function executeApprovedRequest(relayPayload: unknown) {
  const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL;
  if (!relayUrl) throw new Error("NEXT_PUBLIC_RELAY_URL is not configured");

  const response = await fetch(`${relayUrl.replace(/\/$/, "")}/execute-approved-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(relayPayload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "1Shot relay failed");
  return data as {
    tx_hash: string;
    genlayer_record_execution: {
      method: "record_execution";
      args: [string, string];
    };
  };
}

