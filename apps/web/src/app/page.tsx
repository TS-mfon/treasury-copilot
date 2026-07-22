import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Code2, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { Shell } from "@/components/Shell";

const flow = [
  { label: "OWNER", title: "Delegate once", detail: "Bound weekly USDC permission", icon: WalletCards, color: "text-purple" },
  { label: "AGENT", title: "Send JSON", detail: "API key, no wallet SDK", icon: Bot, color: "text-signal" },
  { label: "GENLAYER", title: "Reach consensus", detail: "Caps, policy, justification", icon: ShieldCheck, color: "text-success" },
  { label: "1SHOT", title: "Execute", detail: "Finalized approvals only", icon: CheckCircle2, color: "text-success" },
];

export default function Home() {
  return (
    <Shell>
      <section className="relative min-h-[calc(100vh-7rem)] overflow-hidden border-b border-outline pb-16 pt-10 sm:pt-16">
        <div className="relative z-10 max-w-4xl">
          <div className="badge text-success">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-success" />
            GENLAYER POLICY ENGINE ONLINE
          </div>
          <h1 className="mt-7 text-5xl font-bold leading-[1.04] text-ink sm:text-7xl">
            Treasury Copilot
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-300 sm:text-xl">
            Bounded spending power for autonomous agents. Humans control the policy and delegation; agents use a plain HTTP API; finalized GenLayer approvals execute through 1Shot.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/setup" className="inline-flex items-center gap-2 rounded-md bg-purple px-5 py-3 text-sm font-bold text-black transition hover:bg-violet-300">
              Configure an agent <ArrowRight size={17} />
            </Link>
            <Link href="/docs" className="inline-flex items-center gap-2 rounded-md border border-outline bg-surface-low px-5 py-3 text-sm font-semibold text-ink transition hover:bg-surface-high">
              <Code2 size={17} /> API reference
            </Link>
          </div>
        </div>

        <div className="mt-14 border-y border-outline bg-surface-low/70">
          <div className="grid lg:grid-cols-4">
            {flow.map((item, index) => (
              <div key={item.label} className="min-h-40 border-b border-outline p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-neutral-500">0{index + 1} / {item.label}</span>
                  <item.icon size={18} className={item.color} />
                </div>
                <h2 className="mt-7 text-lg font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm text-neutral-400">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="font-mono text-xs text-purple">TRUST BOUNDARY</p>
            <h2 className="mt-3 text-2xl font-semibold">The agent never receives a spending key.</h2>
          </div>
          <div className="grid gap-4 text-sm leading-7 text-neutral-400 lg:col-span-7 sm:grid-cols-2">
            <p className="border-l-2 border-success pl-4">Every owner, agent, policy, token, chain, and delegated account is matched before a request is accepted or executed.</p>
            <p className="border-l-2 border-purple pl-4">History, verdict reasoning, execution state, and the final EVM transaction hash remain readable from on-chain records.</p>
          </div>
        </div>

        <LockKeyhole className="pointer-events-none absolute -bottom-8 right-0 h-72 w-72 text-neutral-950" strokeWidth={0.6} aria-hidden="true" />
      </section>
    </Shell>
  );
}
