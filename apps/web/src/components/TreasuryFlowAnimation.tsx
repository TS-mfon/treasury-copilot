"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { Bot, CheckCircle2, Code2, ShieldCheck, WalletCards } from "lucide-react";

const lineColor = [0.31, 0.31, 0.34, 1];
const purple = [0.65, 0.55, 0.98, 1];
const green = [0.29, 0.87, 0.5, 1];

const flowAnimation = {
  v: "5.12.2",
  fr: 60,
  ip: 0,
  op: 360,
  w: 1200,
  h: 620,
  nm: "Treasury Copilot payment flow",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0, ind: 1, ty: 4, nm: "Flow lines", sr: 1, ks: {
        o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
      }, ao: 0, shapes: [
        { ty: "sh", ks: { a: 0, k: { i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], v: [[180, 310], [460, 310], [740, 310], [1020, 310]], c: false } } },
        { ty: "st", c: { a: 0, k: lineColor }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 }, lc: 2, lj: 2 },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
      ], ip: 0, op: 360, st: 0, bm: 0,
    },
    {
      ddd: 0, ind: 2, ty: 4, nm: "Request packet", sr: 1, ks: {
        o: { a: 1, k: [{ t: 0, s: [0] }, { t: 12, s: [100] }, { t: 330, s: [100] }, { t: 350, s: [0] }] },
        r: { a: 0, k: 0 },
        p: { a: 1, k: [
          { t: 0, s: [180, 310, 0], e: [460, 310, 0] },
          { t: 90, s: [460, 310, 0], e: [740, 310, 0] },
          { t: 180, s: [740, 310, 0], e: [1020, 310, 0] },
          { t: 270, s: [1020, 310, 0], e: [180, 310, 0] },
          { t: 360, s: [180, 310, 0] },
        ] },
        a: { a: 0, k: [0, 0, 0] }, s: { a: 1, k: [{ t: 0, s: [70, 70, 100] }, { t: 180, s: [120, 120, 100] }, { t: 360, s: [70, 70, 100] }] },
      }, ao: 0, shapes: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [24, 24] } },
        { ty: "fl", c: { a: 1, k: [{ t: 0, s: purple }, { t: 190, s: purple }, { t: 220, s: green }, { t: 360, s: green }] }, o: { a: 0, k: 100 }, r: 1 },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
      ], ip: 0, op: 360, st: 0, bm: 0,
    },
    ...[180, 460, 740, 1020].map((x, index) => ({
      ddd: 0, ind: index + 3, ty: 4, nm: `Node ${index + 1}`, sr: 1, ks: {
        o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [x, 310, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 1, k: [
          { t: index * 90, s: [100, 100, 100] },
          { t: index * 90 + 20, s: [112, 112, 100] },
          { t: index * 90 + 44, s: [100, 100, 100] },
          { t: 360, s: [100, 100, 100] },
        ] },
      }, ao: 0, shapes: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [84, 84] } },
        { ty: "fl", c: { a: 0, k: index === 3 ? green : purple }, o: { a: 0, k: 12 }, r: 1 },
        { ty: "st", c: { a: 0, k: index === 3 ? green : purple }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 }, lc: 2, lj: 2 },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
      ], ip: 0, op: 360, st: 0, bm: 0,
    })),
  ],
};

const nodes = [
  { label: "OWNER", title: "Bound permission", detail: "MetaMask ERC-7715", icon: WalletCards, position: "left-[15%]", color: "text-purple" },
  { label: "AGENT API", title: "Spend request", detail: "API key + JSON", icon: Code2, position: "left-[38.35%]", color: "text-purple" },
  { label: "GENLAYER", title: "Policy review", detail: "Prompt comparative", icon: ShieldCheck, position: "left-[61.7%]", color: "text-purple" },
  { label: "1SHOT", title: "USDC execution", detail: "Finalized approvals", icon: CheckCircle2, position: "left-[85%]", color: "text-success" },
];

export function TreasuryFlowAnimation() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className="relative mx-auto aspect-[1.8/1] min-h-[340px] w-full max-w-6xl overflow-hidden" aria-label="Treasury Copilot payment request flow">
      {!reducedMotion && <Lottie animationData={flowAnimation} autoplay loop className="absolute inset-0 h-full w-full" />}
      {reducedMotion && <div className="absolute left-[15%] right-[15%] top-1/2 h-px bg-outline" />}
      {nodes.map((node) => (
        <div key={node.label} className={`absolute top-1/2 w-44 -translate-x-1/2 -translate-y-1/2 text-center ${node.position}`}>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-outline bg-black/90 shadow-xl shadow-black">
            <node.icon size={25} className={node.color} />
          </div>
          <p className={`mt-5 font-mono text-[10px] font-bold ${node.color}`}>{node.label}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{node.title}</p>
          <p className="mt-1 text-xs text-neutral-500">{node.detail}</p>
        </div>
      ))}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-outline bg-black/90 px-3 py-1.5 font-mono text-[10px] text-neutral-400">
        <Bot size={12} className="text-signal" /> AGENT NEVER RECEIVES A PRIVATE KEY
      </div>
    </div>
  );
}
