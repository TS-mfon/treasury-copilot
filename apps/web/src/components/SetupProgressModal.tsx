"use client";

import { useEffect, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck } from "lucide-react";

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function activeStage(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("authorization") || normalized.includes("confirm")) return 0;
  if (normalized.includes("deploy")) return 1;
  if (normalized.includes("register") || normalized.includes("genlayer")) return 2;
  if (normalized.includes("key")) return 3;
  return 2;
}

const stages = ["Owner authorization", "Policy deployment", "Delegation registration", "API-key issuance"];

export function SetupProgressModal({ open, status }: { open: boolean; status: string }) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) {
      setStartedAt(null);
      setElapsed(0);
      return;
    }
    const now = Date.now();
    setStartedAt((value) => value ?? now);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt ?? now)) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, startedAt]);

  useEffect(() => {
    if (!open) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [open]);

  if (!open) return null;
  const current = activeStage(status);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="setup-progress-title">
      <div className="panel w-full max-w-lg rounded-lg border-purple/40 p-6 shadow-2xl shadow-purple/10">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-purple/15 text-purple">
            <LoaderCircle size={20} className="animate-spin" />
          </div>
          <div>
            <h2 id="setup-progress-title" className="text-lg font-semibold">Generating your API key</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-400">
              This usually takes one to two minutes. Keep this tab open and do not submit again.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-md border border-outline bg-surface-low px-3 py-2 text-xs text-neutral-400">
          <Clock3 size={14} /> Elapsed time: <span className="font-mono text-neutral-200">{formatElapsed(elapsed)}</span>
        </div>

        <ol className="mt-5 grid gap-3" aria-live="polite">
          {stages.map((stage, index) => (
            <li key={stage} className={`flex items-center gap-3 text-sm ${index <= current ? "text-neutral-200" : "text-neutral-600"}`}>
              <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs font-bold ${index < current ? "border-success bg-success/15 text-success" : index === current ? "border-purple bg-purple/15 text-purple" : "border-outline"}`}>
                {index < current ? <ShieldCheck size={13} /> : index + 1}
              </span>
              {stage}
              {index === current && <span className="ml-auto text-xs text-purple">Processing</span>}
            </li>
          ))}
        </ol>

        <p className="mt-5 border-t border-outline pt-4 text-xs leading-5 text-neutral-500">
          GenLayer finality and policy registration are external network operations. Do not refresh or repeat the request while it is processing.
        </p>
      </div>
    </div>
  );
}
