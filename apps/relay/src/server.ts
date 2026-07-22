import { createServer } from "node:http";
const port = Number(process.env.PORT ?? 8787);
const webAppUrl = process.env.WEB_APP_URL;
const cronSecret = process.env.CRON_SECRET;

function json(status: number, payload: unknown) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const response = json(200, { ok: true });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }
  if (req.method !== "POST" || req.url !== "/run") {
    const response = json(404, { error: "not found" });
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return;
  }

  try {
    const received = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!webAppUrl || !cronSecret) throw new Error("relay worker is not configured");
    if (received !== cronSecret) {
      const response = json(401, { error: "unauthorized" });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }
    const upstream = await fetch(new URL("/api/cron/execute", webAppUrl), {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const result = await upstream.json();
    const response = json(upstream.status, result);
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
