import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bot, ShieldCheck, WalletCards } from "lucide-react";
import { Shell } from "@/components/Shell";

export default function Home() {
  const actors: Array<[string, string, LucideIcon]> = [
    ["Human owner", "Connects MetaMask, delegates a weekly USDC allowance, and sets the agent policy.", WalletCards],
    ["GenLayer policy", "Evaluates every agent request against signer, caps, whitelist, and policy fit.", ShieldCheck],
    ["Agent wallet", "Requests funds after GenLayer confirms the spend matches the owner's policy.", Bot],
  ];

  return (
    <Shell>
      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-white/70 px-3 py-1 text-sm font-medium text-teal-800">
            <ShieldCheck size={16} />
            Real funds, policy-gated execution
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-ink sm:text-6xl">
              Treasury Copilot
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-700">
              Give an agent bounded weekly spending power without handing over a private key. GenLayer reviews every request, then our executor moves only approved funds through the delegated MetaMask path.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/setup" className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Start setup <ArrowRight size={17} />
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-md border border-slate-900/15 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="panel rounded-lg p-5">
          <div className="grid gap-4">
            {actors.map(([title, body, Icon]) => (
              <div key={String(title)} className="rounded-lg border border-slate-900/10 bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-teal-50 text-teal-700">
                    <Icon size={19} />
                  </span>
                  <div>
                    <h2 className="font-semibold text-ink">{title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
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
