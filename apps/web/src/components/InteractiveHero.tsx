"use client";

import { ArrowRight, Check, Code2, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SetupAccessLink } from "@/components/SetupAccessLink";
import { PublicTransitionLink } from "@/components/PublicTransitionLink";

const stages = [
  { key: "setup", label: "01", name: "SETUP", detail: "Owner permission", color: "violet" },
  { key: "request", label: "02", name: "REQUEST", detail: "Agent HTTP call", color: "violet" },
  { key: "review", label: "03", name: "REVIEW", detail: "GenLayer policy", color: "amber" },
  { key: "history", label: "04", name: "HISTORY", detail: "Auditable receipt", color: "green" },
];

function StageIcon({ stage }: { stage: string }) {
  if (stage === "setup") return <ShieldCheck size={20} />;
  if (stage === "request") return <Code2 size={20} />;
  if (stage === "review") return <span className="motion-hex">◆</span>;
  return <Check size={20} />;
}

function JourneyGraphic({ reducedMotion }: { reducedMotion: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setActive(3);
      return;
    }
    const timer = window.setInterval(() => setActive((value) => (value + 1) % stages.length), 2600);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  const activeStage = stages[active];
  return (
    <div className="journey-graphic" aria-label="Treasury Copilot payment journey">
      <div className="journey-graphic-topline">
        <span className="journey-status"><i /> LIVE PAYMENT TRACE</span>
        <span>TESTNET / BASE SEPOLIA</span>
      </div>
      <div className="journey-rail" aria-hidden="true">
        <div className="journey-rail-fill" style={{ width: `${(active / (stages.length - 1)) * 100}%` }} />
        <div className="journey-packet" style={{ left: `${active * 33.33}%` }} />
      </div>
      <div className="journey-stages">
        {stages.map((stage, index) => (
          <div className={`journey-stage ${index === active ? "is-active" : ""} ${index < active ? "is-complete" : ""}`} key={stage.key}>
            <div className={`journey-stage-icon ${stage.color}`}><StageIcon stage={stage.key} /></div>
            <span className="journey-stage-number">{stage.label}</span>
            <strong>{stage.name}</strong>
            <small>{stage.detail}</small>
          </div>
        ))}
      </div>
      <div className="journey-detail" aria-live="polite">
        <div className={`journey-detail-icon ${activeStage.color}`}><StageIcon stage={activeStage.key} /></div>
        <div><span>NOW PROCESSING</span><strong>{activeStage.name}</strong><p>{activeStage.detail}</p></div>
        <div className="journey-detail-sentinel"><span>SENTINEL</span><b>{active === 2 ? "COMPARING POLICY" : active === 3 ? "RECEIPT VERIFIED" : "BOUNDARY READY"}</b></div>
      </div>
      <div className="journey-outcomes">
        <div className="journey-outcome approved"><Check size={15} /><span><b>APPROVED</b> within policy</span></div>
        <div className="journey-outcome blocked"><X size={15} /><span><b>BLOCKED</b> no funds moved</span></div>
      </div>
    </div>
  );
}

export function InteractiveHero() {
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    updateMotion();
    media.addEventListener("change", updateMotion);
    const onScroll = () => setProgress(Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.9)));
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      media.removeEventListener("change", updateMotion);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section className="hero-shell" aria-labelledby="hero-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-glow hero-glow-one" aria-hidden="true" />
      <div className="hero-glow hero-glow-two" aria-hidden="true" />
      <div className="hero-copy">
        <div className="hero-kicker"><span className="hero-live-dot" /> POLICY CONTROL PLANE / TESTNET LIVE</div>
        <h1 id="hero-title">Financial control for autonomous agents.</h1>
        <p>Give agents a budget, not your private keys. Treasury Copilot turns an agent payment request into a bounded, policy reviewed, auditable outcome.</p>
        <div className="hero-actions">
          <SetupAccessLink href="/setup" className="hero-primary"><span>Configure an agent</span><ArrowRight size={16} /></SetupAccessLink>
          <PublicTransitionLink href="/docs" className="hero-secondary"><Code2 size={16} /><span>Read the API</span></PublicTransitionLink>
        </div>
        <div className="hero-proof-row"><span>BASE SEPOLIA USDC</span><span>GENLAYER REVIEW</span><span>ERC 7715 BOUNDS</span></div>
      </div>
      <div className="hero-canvas-wrap hero-motion-wrap" style={{ transform: `translate3d(0, ${progress * 72}px, 0) scale(${1 - progress * 0.08})` }}>
        <JourneyGraphic reducedMotion={reducedMotion} />
        <div className="hero-canvas-caption"><ShieldCheck size={15} /> SENTINEL / REVIEWING POLICY</div>
      </div>
      <div className="hero-scroll-cue" aria-hidden="true"><span /> SCROLL TO TRACE A PAYMENT</div>
    </section>
  );
}

export function HeroMiniProof() {
  const items = useMemo(() => [
    { icon: Check, label: "APPROVED", detail: "within policy", color: "#4ade80" },
    { icon: X, label: "BLOCKED", detail: "no funds moved", color: "#f87171" },
  ], []);
  return <div className="hero-mini-proof">{items.map(({ icon: Icon, label, detail, color }) => <div key={label}><Icon size={15} style={{ color }} /><span><strong>{label}</strong>{detail}</span></div>)}</div>;
}
