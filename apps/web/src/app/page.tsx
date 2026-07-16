import Link from "next/link";
import { ArrowRight, Bot, Code2, History, ShieldCheck, WalletCards } from "lucide-react";
import { Shell } from "@/components/Shell";
import type { LucideIcon } from "lucide-react";

const cards: Array<[string, string, LucideIcon]> = [
  ["Delegate once", "The owner grants bounded token spending from their own wallet or smart account.", WalletCards],
  ["Review every request", "GenLayer checks the agent, delegation, caps, whitelist, and policy text before funds move.", ShieldCheck],
  ["Agent-friendly API", "Agents call HTTP with an API key. The platform signer handles GenLayer and 1Shot execution.", Bot],
  ["Auditable history", "Verdicts, reasoning, request ids, and tx hashes stay readable from on-chain state.", History],
];

export default function Home() {
  return (
    <Shell>
      <section className="grid min-h-[calc(100vh-130px)] gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-outline bg-surface-low px-3 py-1 text-sm font-semibold text-purple">
            <ShieldCheck size={16} />
            Bounded spending power for autonomous agents
          </div>
          <div className="space-y-5">
            <h1 className="max-w-4xl text-5xl font-bold tracking-normal text-ink sm:text-7xl">
              Treasury Copilot
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-neutral-300">
              Give an AI agent permission to pay for real work without handing it a private key. Humans set the policy and delegation; agents submit JSON; GenLayer decides; 1Shot executes only approved payouts.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/setup" className="inline-flex items-center gap-2 rounded-md bg-purple px-5 py-3 text-sm font-bold text-black transition hover:bg-violet-300">
              Configure treasury <ArrowRight size={17} />
            </Link>
            <Link href="/docs" className="inline-flex items-center gap-2 rounded-md border border-outline bg-surface-low px-5 py-3 text-sm font-semibold text-ink transition hover:bg-surface-high">
              <Code2 size={17} /> Read API docs
            </Link>
          </div>
        </div>

        <div className="panel rounded-lg p-5">
          <div className="grid gap-4">
            {cards.map(([title, body, Icon]) => (
              <div key={String(title)} className="rounded-lg border border-outline bg-paper p-4 transition hover:bg-surface-high">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-outline bg-surface-low text-purple">
                    <Icon size={19} />
                  </span>
                  <div>
                    <h2 className="font-semibold text-ink">{title}</h2>
                    <p className="mt-1 text-sm leading-6 text-neutral-400">{body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </Shell>
  );
}
