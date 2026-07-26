import { BookOpen, Code2, Terminal } from "lucide-react";
import { Shell } from "@/components/Shell";

const spendExample = `curl -X POST https://treasury-copilot-genjury.vercel.app/api/v1/spend \\
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

const balanceExample = `curl -X GET https://treasury-copilot-genjury.vercel.app/api/v1/balance \\
  -H "Authorization: Bearer ***"`;

const historyExample = `curl -X GET "https://treasury-copilot-genjury.vercel.app/api/v1/history?limit=50" \\
  -H "Authorization: Bearer ***"`;

const requestExample = `curl -X GET https://treasury-copilot-genjury.vercel.app/api/v1/requests/0xREQUEST_ID \\
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
                Base URL: <span className="font-mono text-xs text-neutral-300">https://treasury-copilot-genjury.vercel.app</span>. All agent paths are under <span className="font-mono text-xs text-neutral-300">/api/v1</span>. Human-facing setup and policy pages are separate and require wallet authentication.
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
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">Authorization: Bearer tcp_***</pre>
          <p className="mt-3 text-xs text-neutral-500">
            The MetaMask permission does not create the key. A fresh unique key is issued only after the GenLayer policy and delegation are finalized, registered, and read back successfully. Keys are shown once during setup. Store them securely. Rotation increments the on-chain key version and invalidates older keys; revocation deactivates the policy binding.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Quickstart</h2>
          <ol className="mt-4 grid gap-3 text-sm text-neutral-300">
            <li><span className="font-mono text-purple">1.</span> Store the one-time API key in a secret manager or environment variable.</li>
            <li><span className="font-mono text-purple">2.</span> Call <span className="font-mono">GET /balance</span> and use the returned agent address exactly.</li>
            <li><span className="font-mono text-purple">3.</span> Submit a decimal string amount with a stable idempotency key.</li>
            <li><span className="font-mono text-purple">4.</span> Save the request ID and poll the request endpoint after timeouts.</li>
          </ol>
          <p className="mt-4 text-sm text-neutral-400">
            The key identifies the agent but never signs a blockchain transaction. Every GenLayer write is signed by the server platform wallet after the key, registry, policy, funding account, chain, token, and execution reporter are verified.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Code2 size={18} /> POST /api/v1/spend</h2>
          <p className="mt-2 text-neutral-400">
            Submits one spend request and waits for GenLayer finality. Finalized approvals immediately attempt 1Shot execution; the authenticated relay worker retries requests whose execution failed. Use an idempotency_key to avoid duplicate processing.
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
  "verdict": "approved",
  "reasoning": "The request matches the exact recipient and policy",
  "request": {
    "status": "executed",
    "recipient": "0x...",
    "amount": "25",
    "amount_units": "25000000",
    "decision_mode": "prompt_comparative",
    "execution_status": "executed",
    "tx_hash": "0x...",
    "explorer_url": "https://sepolia.basescan.org/tx/0x...",
    "created_at": "2026-07-21T12:10:00.000Z",
    "updated_at": "2026-07-21T12:11:00.000Z"
  },
  "chain": {
    "chain_id": 84532,
    "name": "Base Sepolia",
    "explorer_url": "https://sepolia.basescan.org"
  },
  "idempotent_replay": false,
  "execution": {
    "mode": "erc7710",
    "fee_amount": "0.01",
    "fee_amount_units": "10000"
  },
  "genlayer": {
    "request_tx_hash": "0x...",
    "record_execution_tx_hash": "0x..."
  }
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
          <h2 className="text-xl font-semibold">Merchant identity and policy safety</h2>
          <p className="mt-2 text-neutral-400">
            Category and justification are untrusted agent claims. A merchant name does not prove recipient ownership or invoice validity. Put the exact approved recipient address in the policy, enable the recipient whitelist, and set every legacy V2 fast approval limit to zero.
          </p>
          <p className="mt-3 text-neutral-400">
            Policy V3 uses GenLayer prompt-comparative review for every amount. Evidence-backed invoice and merchant verification is required before safe fast approval can return.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Terminal size={18} /> GET /api/v1/requests/:id</h2>
          <p className="mt-2 text-neutral-400">
            Returns one request record by ID, scoped to the authenticated API key. Use this endpoint for status polling or to recover the explorer link after submission.
          </p>
          <pre className="terminal mt-4 overflow-auto p-4 text-xs">{requestExample}</pre>
          <p className="mt-4 text-sm text-neutral-400">
            GET /api/v1/policy returns safe caps and policy metadata. Raw delegation payloads, permission contexts, signatures, and signer secrets are never returned to agents.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Lifecycle and polling</h2>
          <div className="mt-4 grid gap-px overflow-hidden border border-outline bg-outline sm:grid-cols-5">
            {[
              ["submitted", "Platform signs and sends the policy request."],
              ["finalized", "The GenLayer decision is no longer appealable."],
              ["executing", "The platform holds the on-chain execution lease."],
              ["failed", "The lease is released and the request can retry."],
              ["executed", "The confirmed EVM transaction hash is recorded."],
            ].map(([status, detail]) => (
              <div key={status} className="bg-paper p-4">
                <p className="font-mono text-xs text-purple">{status}</p>
                <p className="mt-2 text-xs leading-5 text-neutral-400">{detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-neutral-400">
            If the spend request times out at the HTTP layer, poll GET /api/v1/requests/:id with the same API key. Do not submit a different idempotency key for the same intended payment.
          </p>
          <p className="mt-3 text-sm text-neutral-400">
            An identical replay returns <span className="font-mono">idempotent_replay: true</span>, the same request ID, and the same Base transaction hash without another payment.
          </p>
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
}

{
  "error": "genlayer_unavailable",
  "message": "submit_request submission failed on GenLayer: ...",
  "fields": {},
  "retryable": true
}`}</pre>
          <p className="mt-4 text-sm text-neutral-400">
            Retry only 502 and 503 responses, use exponential backoff, and keep the same idempotency key. Do not automatically retry authentication, validation, policy, or conflict errors.
          </p>
        </section>

        <section className="panel rounded-lg p-6">
          <h2 className="text-xl font-semibold">Trust model</h2>
          <p className="mt-2 text-neutral-400">
            The agent never receives custody and does not need a wallet library or gas. The owner grants bounded token spending to the platform signer. GenLayer verifies the registered agent and policy. Only approved requests are executed through 1Shot, then the EVM transaction hash is written back to GenLayer. Relayer failures leave on-chain records so requests can be retried safely with no duplicate payout risk.
          </p>
          <p className="mt-3 text-neutral-400">
            Current execution support is Base Sepolia USDC. X Layer and other chains remain disabled until the live 1Shot capability response confirms the selected token and transaction mode.
          </p>
        </section>
      </article>
    </Shell>
  );
}
