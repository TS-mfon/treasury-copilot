import Link from "next/link";
import { ArrowRight, Braces, CheckCircle2, Code2, FileCheck2, KeyRound, LockKeyhole, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import { Shell } from "@/components/Shell";
import { SetupAccessLink } from "@/components/SetupAccessLink";
import { TreasuryFlowAnimation } from "@/components/TreasuryFlowAnimation";

const safeguards = [
  { icon: KeyRound, title: "No agent private keys", detail: "Agents authenticate through scoped API keys that identify them but never sign blockchain transactions." },
  { icon: ShieldCheck, title: "Every request reviewed", detail: "Deterministic checks and GenLayer prompt-comparative review evaluate every valid payment request." },
  { icon: RotateCcw, title: "Owner-controlled revocation", detail: "Owners retain custody, policy control, API-key rotation, and the ability to stop future execution." },
];

const lifecycle = [
  ["01", "REQUEST", "The agent submits recipient, exact amount, category, justification, and optional evidence through HTTP."],
  ["02", "VERIFY", "Treasury Copilot matches the API key to the owner, agent, policy, chain, token, and delegated funding account."],
  ["03", "REVIEW", "GenLayer determines whether the request satisfies the owner’s natural-language policy and evidence requirements."],
  ["04", "EXECUTE", "1Shot executes only a finalized approval, and the transaction hash is written back to the on-chain history."],
];

export default function Home() {
  return (
    <Shell>
      <section className="relative flex min-h-[680px] items-center overflow-hidden border-b border-outline py-16 sm:min-h-[720px]">
        <div className="pointer-events-none absolute inset-0 opacity-35 lg:left-[25%] lg:opacity-75">
          <TreasuryFlowAnimation />
        </div>
        <div className="relative z-10 max-w-3xl bg-black/80 py-6 pr-4 backdrop-blur-sm lg:bg-black/65">
          <div className="badge text-success">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-success" />
            GENLAYER POLICY ENGINE ONLINE
          </div>
          <h1 className="mt-7 text-5xl font-bold leading-[1.04] text-ink sm:text-7xl">Treasury Copilot</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-300 sm:text-xl">
            The financial control plane for autonomous agents. Give agents useful USDC spending power without giving them unrestricted custody.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <SetupAccessLink href="/setup" className="inline-flex items-center gap-2 rounded-md bg-purple px-5 py-3 text-sm font-bold text-black transition hover:bg-violet-300">
              Configure an agent <ArrowRight size={17} />
            </SetupAccessLink>
            <Link href="/docs" className="inline-flex items-center gap-2 rounded-md border border-outline bg-surface-low px-5 py-3 text-sm font-semibold text-ink transition hover:bg-surface-high">
              <Code2 size={17} /> API reference
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-neutral-500">
            <span>BASE SEPOLIA USDC</span>
            <span>GENLAYER STUDIONET</span>
            <span>METAMASK ERC-7715</span>
          </div>
        </div>
      </section>

      <section className="border-b border-outline py-20">
        <div className="max-w-3xl">
          <p className="font-mono text-xs text-purple">THE PAYMENT JOURNEY</p>
          <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">From agent intent to auditable execution.</h2>
          <p className="mt-4 text-base leading-7 text-neutral-400">One bounded flow connects human custody, an agent-friendly API, intelligent policy review, and settlement.</p>
        </div>
        <div className="mt-8 border-y border-outline bg-surface-low/40">
          <TreasuryFlowAnimation />
        </div>
      </section>

      <section className="grid gap-10 border-b border-outline py-20 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="font-mono text-xs text-success">HOW IT WORKS</p>
          <h2 className="mt-3 text-3xl font-semibold">Plain HTTP in. Policy-controlled payment out.</h2>
        </div>
        <div className="grid gap-px border border-outline bg-outline lg:col-span-8 sm:grid-cols-2">
          {lifecycle.map(([number, title, detail]) => (
            <div key={number} className="min-h-52 bg-black p-6">
              <div className="font-mono text-xs text-neutral-600">{number} / {title}</div>
              <p className="mt-8 text-sm leading-7 text-neutral-300">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-outline py-20">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="font-mono text-xs text-signal">DEVELOPER EXPERIENCE</p>
            <h2 className="mt-3 text-3xl font-semibold">Agents integrate with JSON, not wallet infrastructure.</h2>
            <p className="mt-4 max-w-xl leading-7 text-neutral-400">The platform handles GenLayer submission, policy binding, finality, execution, and audit history behind a stable HTTP interface.</p>
            <Link href="/agent" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-purple">Explore the Agent API <ArrowRight size={16} /></Link>
          </div>
          <div className="terminal overflow-hidden lg:col-span-7">
            <div className="flex items-center gap-2 border-b border-outline px-4 py-3 text-xs text-neutral-500"><Braces size={14} /> POST /api/v1/spend</div>
            <pre className="overflow-x-auto p-5 text-xs leading-6 text-neutral-300">{`{
  "recipient": "0xMerchant...",
  "amount": "12.50",
  "category": "infrastructure",
  "justification": "Monthly deployment service"
}`}</pre>
          </div>
        </div>
      </section>

      <section className="border-b border-outline py-20">
        <div className="max-w-3xl">
          <p className="font-mono text-xs text-purple">TRUST BOUNDARY</p>
          <h2 className="mt-3 text-3xl font-semibold">Useful autonomy without unrestricted custody.</h2>
        </div>
        <div className="mt-10 grid gap-px border border-outline bg-outline md:grid-cols-3">
          {safeguards.map((item) => (
            <div key={item.title} className="min-h-64 bg-black p-6">
              <item.icon size={22} className="text-purple" />
              <h3 className="mt-10 text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-10 border-b border-outline py-20 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <FileCheck2 size={24} className="text-success" />
          <h2 className="mt-5 text-3xl font-semibold">Every decision leaves a trail.</h2>
          <p className="mt-4 max-w-xl leading-7 text-neutral-400">Request identity, policy version, verdict reasoning, execution state, and the final Base transaction hash remain available for review.</p>
        </div>
        <div className="grid gap-4 font-mono text-xs lg:col-span-6">
          {["REQUEST ACCEPTED", "GENLAYER REVIEW FINALIZED", "POLICY APPROVED", "1SHOT EXECUTION CONFIRMED", "BASE TX HASH RECORDED"].map((item, index) => (
            <div key={item} className="flex items-center gap-3 border-b border-outline pb-3 text-neutral-400">
              <CheckCircle2 size={15} className={index === 4 ? "text-success" : "text-purple"} /> {item}
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden py-24 text-center">
        <WalletCards className="mx-auto text-purple" size={30} />
        <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold">Give your agents a budget, not your treasury.</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-neutral-400">Connect an owner wallet, grant bounded spending permission, define the policy, and issue an agent API key.</p>
        <div className="mt-8 flex justify-center gap-3">
          <SetupAccessLink href="/setup" className="inline-flex items-center gap-2 rounded-md bg-purple px-5 py-3 text-sm font-bold text-black">Start setup <ArrowRight size={17} /></SetupAccessLink>
          <Link href="/docs" className="inline-flex items-center gap-2 rounded-md border border-outline px-5 py-3 text-sm font-semibold">Read the docs</Link>
        </div>
        <LockKeyhole className="pointer-events-none absolute -bottom-14 left-1/2 h-64 w-64 -translate-x-1/2 text-neutral-950" strokeWidth={0.5} aria-hidden="true" />
      </section>
    </Shell>
  );
}
