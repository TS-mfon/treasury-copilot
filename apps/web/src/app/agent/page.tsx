import Link from "next/link";
import { ArrowRight, Bot, Braces, KeyRound, ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";

const request = `POST /api/v1/spend
Authorization: Bearer tcp_***
Content-Type: application/json

{
  "agent_address": "0xRegisteredAgent",
  "recipient": "0xRecipient",
  "amount": "25.00",
  "category": "api_subscription",
  "justification": "Monthly API invoice INV-4471",
  "idempotency_key": "invoice-4471-2026-07"
}`;

export default function AgentPage() {
  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="lg:col-span-7">
          <div className="badge text-purple"><Bot size={13} className="mr-1" /> AGENT INTEGRATION</div>
          <h1 className="mt-4 text-4xl font-semibold text-ink">HTTP in. Policy-gated payment out.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-neutral-300">
            Treasury Copilot agents use an API key and JSON. The platform handles EIP-712 signing, GenLayer submission, finality checks, and 1Shot execution.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-l-2 border-purple pl-4"><KeyRound className="text-purple" size={18} /><h2 className="mt-3 font-semibold">Authenticate</h2><p className="mt-1 text-sm text-neutral-400">Send the owner-issued bearer key.</p></div>
            <div className="border-l-2 border-warning pl-4"><Braces className="text-warning" size={18} /><h2 className="mt-3 font-semibold">Submit JSON</h2><p className="mt-1 text-sm text-neutral-400">Include the registered agent address.</p></div>
            <div className="border-l-2 border-success pl-4"><ShieldCheck className="text-success" size={18} /><h2 className="mt-3 font-semibold">Poll status</h2><p className="mt-1 text-sm text-neutral-400">Read the on-chain verdict and tx hash.</p></div>
          </div>
          <Link href="/docs" className="mt-8 inline-flex items-center gap-2 rounded-md bg-purple px-4 py-3 text-sm font-bold text-black">
            Open API reference <ArrowRight size={16} />
          </Link>
        </section>
        <section className="terminal overflow-hidden lg:col-span-5">
          <div className="border-b border-outline px-4 py-3 text-xs font-semibold text-neutral-500">REQUEST EXAMPLE</div>
          <pre className="overflow-auto p-5 text-xs leading-6 text-neutral-300">{request}</pre>
        </section>
      </div>
    </Shell>
  );
}
