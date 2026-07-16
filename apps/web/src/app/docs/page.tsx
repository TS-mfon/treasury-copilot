import { BookOpen, Code2, Terminal } from "lucide-react";
import { Shell } from "@/components/Shell";

const spendExample = `curl -X POST https://YOUR_DOMAIN/api/v1/spend \\
  -H "Authorization: Bearer ***" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_address": "0xYourRegisteredAgent",
    "recipient": "0xabc...",
    "amount": "25.00",
    "category": "api_subscription",
    "justification": "Monthly API renewal, invoice #4471",
    "idempotency_key": "billing-4471-2026-07"
  }'`;

const balanceExample = `curl -X GET https://YOUR_DOMAIN/api/v1/balance \\
  -H "Authorization: Bearer ***"`;

const historyExample = `curl -X GET "https://YOUR_DOMAIN/api/v1/history?limit=50" \\
  -H "Authorization: Bearer ***"`;

const requestExample = `curl -X GET https://YOUR_DOMAIN/api/v1/requests/0xREQUEST_ID \\
  -H "Authorization: Bearer ***"`;

export default function DocsPage() {
  return (
    <Shell>
      <article className="grid gap-6">
        <section className="panel rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="badge text-purple">DEVELOPER DOCS</div>
              <h1 className="mt-3 text-3xl font-semibold text-ink">Agent API</h1>
              <p className="mt-2 max-w-3xl text-neutral-400">
                Agents integrate with Treasury Copilot through HTTP only. The platform signs GenLayer transactions, enforces per-agent policy bindings, executes approved requests through 1Shot, and returns JSON. No wallet library, gas management, or GenLayer SDK is required.
              </p>
              <p className="mt-2 max-w-3xl text-neutral-400">
                Base URL: <span className="font-mono text-xs text-neutral-300">https://YOUR_DOMAIN</span>. All agent paths are under <span className="font-mono text-xs text-neutral-300">/api/v1</span>. Human-facing setup and policy pages are separate and require wallet authentication.
              </p>
            </div>
            <BookOpen className="text-purple" />
          </div>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Authentication</h2>
          <p className="mt-2 text-neutral-400">
            Send the bearer API key issued during owner setup. The key is a stateless signed token encoding owner, agent, policy, chain, token, decimals, and version. Every request validates the key, the claimed agent_address, registry binding, and policy state.
          </p>
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">Authorization: Bearer tc_***</pre>
          <p className="mt-3 text-xs text-neutral-500">
            Keys are shown once during setup. Store them securely. Rotation and revocation are owner-only operations in authenticated UI and do not require a new setup ceremony.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Code2 size={18} /> POST /api/v1/spend</h2>
          <p className="mt-2 text-neutral-400">
            Submits one spend request. GenLayer evaluates it and returns pending, approved, or denied. Approved requests are picked up by the platform relay worker, executed through 1Shot, and written back on-chain. Use an idempotency_key to avoid duplicate processing.
          </p>
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">{spendExample}</pre>
          <h3 className="mt-6 text-sm font-semibold text-neutral-300">Request body</h3>
          <pre className="terminal mt-2 overflow-auto p-4 text-xs">{`{
  "agent_address": "0xYourRegisteredAgent",
  "recipient": "0xRecipient",
  "amount": "25.00",
  "category": "api_subscription",
  "justification": "Monthly API renewal invoice #4471",
  "idempotency_key": "billing-4471-2026-07"
}`}</pre>
          <h3 className="mt-6 text-sm font-semibold text-neutral-300">Response</h3>
          <pre className="terminal mt-2 overflow-auto p-4 text-xs">{`{
  "request_id": "0x...",
  "agent": "0x...",
  "recipient": "0x...",
  "amount": "25.00",
  "amount_units": "25000000",
  "token_decimals": 6,
  "verdict": "approved",
  "reasoning": "Within auto-approve threshold.",
  "tx_hash": "0x...",
  "explorer_url": "https://basescan.org/tx/0x...",
  "status": "approved",
  "created_at": "2026-07-16T22:10:00.000Z",
  "updated_at": "2026-07-16T22:10:00.000Z"
}`}</pre>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="panel rounded-lg p-6">
            <h2 className="text-xl font-semibold">GET /api/v1/balance</h2>
            <p className="mt-2 text-neutral-400">Returns live token balance, weekly spent, weekly cap, and per-request cap. Values include display decimals and raw integer units.</p>
            <pre className="terminal mt-4 overflow-auto p-4 text-xs">{balanceExample}</pre>
          </div>
          <div className="panel rounded-lg p-6">
            <h2 className="text-xl font-semibold">GET /api/v1/history</h2>
            <p className="mt-2 text-neutral-400">Returns on-chain request history from GenLayer for the current API key binding. Includes status, verdict, reasoning, and execution hash when available.</p>
            <pre className="terminal mt-4 overflow-auto p-4 text-xs">{historyExample}</pre>
          </div>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Terminal size={18} /> GET /api/v1/requests/:id</h2>
          <p className="mt-2 text-neutral-400">
            Returns one request record by ID, scoped to the authenticated API key. Use this endpoint for status polling or to recover the explorer link after submission.
          </p>
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">{requestExample}</pre>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Amounts and decimals</h2>
          <p className="mt-2 text-neutral-400">
            Send amount as a positive decimal string. Never send JavaScript floating-point values. The server converts amounts using the configured asset decimals, which may be 6 for USDC. Every balance, cap, and history response returns both a display decimal value and the raw on-chain integer units. Requests whose request ID has already been recorded are returned idempotently instead of creating a duplicate spend.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Error codes</h2>
          <p className="mt-2 text-neutral-400">All errors return JSON with machine-readable structure and machine-parseable fields when available.</p>
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">{`{
  "error": "invalid_api_key",
  "message": "API key is missing or invalid",
  "fields": { "authorization": ["missing bearer token"] },
  "request_id": "abc-123"
}

{
  "error": "agent_mismatch",
  "message": "The agent_address in this request does not match the API key claim",
  "fields": { "agent_address": ["0x... does not match 0x..."] }
}

{
  "error": "insufficient_balance",
  "message": "Delegated balance is below the requested amount",
  "fields": { "amount": ["requested 25.00 USDC, available 4.20 USDC"] }
}`}</pre>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Trust model</h2>
          <p className="mt-2 text-neutral-400">
            The agent never receives custody and does not need a wallet library or gas. The owner grants bounded token spending to the platform signer. GenLayer verifies the registered agent and policy. Only approved requests are executed through 1Shot, then the EVM transaction hash is written back to GenLayer. Relayer failures leave on-chain records so requests can be retried safely with no duplicate payout risk.
          </p>
        </section>
      </article>
    </Shell>
  );
}
