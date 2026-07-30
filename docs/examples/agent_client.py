import os
import time
import requests

API_BASE = os.getenv(
    "TREASURY_API_BASE",
    "https://treasury-copilot-genjury.vercel.app/api/v1",
)
API_KEY = os.environ["TREASURY_API_KEY"]
AGENT_ADDRESS = os.environ["AGENT_ADDRESS"]
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Accept": "application/json",
}


def api(method, path, **kwargs):
    response = requests.request(
        method,
        f"{API_BASE}{path}",
        headers=HEADERS,
        timeout=30,
        **kwargs,
    )
    body = response.json()
    if response.status_code not in (200, 202):
        raise RuntimeError(f"{body.get('error')}: {body.get('message')}")
    return response, body


_, policy = api("GET", "/policy")
recipients = policy["state"]["whitelisted_recipients"]
if not recipients:
    raise RuntimeError("The owner has not configured an API-discoverable recipient")

idempotency_key = "invoice-4471-2026-07"
_, queued = api(
    "POST",
    "/spend",
    json={
        "agent_address": AGENT_ADDRESS,
        "recipient": recipients[0],
        "amount": "2.50",
        "category": "software_subscription",
        "justification": "Monthly build service invoice INV-4471",
        "idempotency_key": idempotency_key,
        "evidence": [],
    },
)

request = queued["request"]
while request["status"] not in ("denied", "executed", "failed"):
    time.sleep(10)
    _, current = api("GET", f"/requests/{queued['request_id']}")
    request = current["request"]

print(request)
