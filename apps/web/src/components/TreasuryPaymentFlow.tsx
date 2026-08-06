"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Viewport = "desktop" | "mobile";

const phaseDurations = [2400, 2400, 3000, 4200, 3000, 2600, 2600];
const phaseNames = [
  "Owner permission",
  "Agent API request",
  "Treasury Copilot verification",
  "GenLayer comparative review",
  "1Shot execution",
  "Base settlement",
  "On-chain audit trail",
];

const colors = {
  purple: "#a78bfa",
  green: "#4ade80",
  amber: "#fbbf24",
  red: "#f87171",
  ink: "#f5f5f5",
  muted: "#a3a3a3",
  outline: "#525252",
  surface: "#0a0a0a",
};

const desktopStages = [
  { x: 125, y: 355, label: "OWNER", title: "Bound permission", detail: "MetaMask ERC-7715" },
  { x: 385, y: 355, label: "AGENT API", title: "Spend request", detail: "HTTP + API key" },
  { x: 660, y: 355, label: "COPILOT", title: "Verify request", detail: "Deterministic checks" },
  { x: 955, y: 355, label: "GENLAYER", title: "Policy review", detail: "Prompt comparative" },
  { x: 1230, y: 355, label: "1SHOT", title: "Execute", detail: "Finalized approval" },
  { x: 1480, y: 355, label: "BASE", title: "Receipt", detail: "USDC settled" },
];

const mobileStages = [
  { x: 62, y: 95, label: "OWNER", title: "Bound permission", detail: "MetaMask ERC-7715" },
  { x: 62, y: 245, label: "AGENT API", title: "Spend request", detail: "HTTP + scoped API key" },
  { x: 62, y: 395, label: "COPILOT", title: "Verify request", detail: "Identity · budget · replay" },
  { x: 62, y: 555, label: "GENLAYER", title: "Policy review", detail: "Prompt comparative consensus" },
  { x: 62, y: 855, label: "1SHOT", title: "Execute", detail: "Finalized approval only" },
  { x: 62, y: 1010, label: "BASE", title: "USDC receipt", detail: "Settlement confirmed" },
];

function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>("desktop");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setViewport(query.matches ? "mobile" : "desktop");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return viewport;
}

function stageColor(index: number, phase: number) {
  if (index === 3 && phase === 3) return colors.amber;
  if (index === 5 && phase >= 5) return colors.green;
  if (phase > index) return colors.green;
  if (phase === index) return colors.purple;
  return colors.outline;
}

function StageGlyph({ index, color }: { index: number; color: string }) {
  if (index === 0) {
    return <><rect x="-18" y="-14" width="36" height="28" rx="5" fill="none" stroke={color} strokeWidth="2" /><path d="M-9 14v5h18v-5M-8-5h16" fill="none" stroke={color} strokeWidth="2" /><circle cx="0" cy="-5" r="2" fill={color} /></>;
  }
  if (index === 1) {
    return <><rect x="-20" y="-15" width="40" height="30" rx="4" fill="none" stroke={color} strokeWidth="2" /><path d="m-11-2 5 4-5 4M-1 7h10" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" /></>;
  }
  if (index === 2) {
    return <><rect x="-17" y="-17" width="34" height="34" rx="8" fill="none" stroke={color} strokeWidth="2" /><path d="m-9 0 6 6 12-13" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></>;
  }
  if (index === 3) {
    return <><path d="M0-20 18-10v20L0 20l-18-10v-20Z" fill="none" stroke={color} strokeWidth="2" /><circle cx="0" cy="0" r="4" fill={color} /></>;
  }
  if (index === 4) {
    return <><path d="M-18-15 18 0-18 15l7-15Z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /><path d="M-5 0h14" stroke={color} strokeWidth="2" strokeLinecap="round" /></>;
  }
  return <><rect x="-19" y="-15" width="38" height="30" rx="4" fill="none" stroke={color} strokeWidth="2" /><path d="M-12-15v30M0-15v30M12-15v30M-19-3h38M-19 8h38" stroke={color} strokeWidth="1.5" opacity=".7" /></>;
}

function ValidatorGroup({ phase, viewport }: { phase: number; viewport: Viewport }) {
  const center = viewport === "desktop" ? { x: 955, y: 355 } : { x: 230, y: 675 };
  const offsets = viewport === "desktop"
    ? [[0, -115], [100, -58], [100, 58], [-100, 58], [-100, -58]]
    : [[-96, 0], [-48, 0], [0, 0], [48, 0], [96, 0]];
  const labels = ["01", "02", "03", "04", "05"];

  return (
    <g aria-label="Five GenLayer validators">
      {offsets.map(([dx, dy], index) => {
        const active = phase === 3;
        const complete = phase > 3;
        const color = complete ? colors.green : active ? colors.amber : colors.outline;
        return (
          <g key={labels[index]} transform={`translate(${center.x + dx} ${center.y + dy})`} opacity={phase >= 3 ? 1 : .58}>
            <circle r="21" fill={colors.surface} stroke={color} strokeWidth="2" className={active ? "flow-validator-pulse" : ""} />
            <text x="0" y="4" fill={color} fontSize="11" fontFamily="ui-monospace, monospace" textAnchor="middle">V{labels[index]}</text>
            {complete && <path d="m-7 1 5 5 10-11" fill="none" stroke={colors.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </g>
        );
      })}
      {viewport === "mobile" && (
        <>
          <text x={center.x} y={center.y - 38} fill={phase >= 3 ? colors.amber : colors.muted} fontSize="10" fontFamily="ui-monospace, monospace" textAnchor="middle">FIVE INDEPENDENT VALIDATOR VOTES</text>
          <text x={center.x} y={center.y + 42} fill={phase > 3 ? colors.green : phase >= 3 ? colors.amber : colors.muted} fontSize="11" fontFamily="ui-monospace, monospace" textAnchor="middle">{phase > 3 ? "5 / 5 APPROVE" : "INDEPENDENT REVIEW"}</text>
        </>
      )}
    </g>
  );
}

function RequestPanel({ phase, viewport }: { phase: number; viewport: Viewport }) {
  if (viewport === "mobile") return null;
  const x = viewport === "desktop" ? 385 : 195;
  const y = viewport === "desktop" ? 205 : 235;
  const width = viewport === "desktop" ? 190 : 250;
  return (
    <g opacity={phase >= 1 ? 1 : .58} transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y="-48" width={width} height="96" rx="8" fill={colors.surface} stroke={phase === 1 ? colors.purple : colors.outline} />
      <text x={-width / 2 + 14} y="-25" fill={colors.purple} fontSize="10" fontFamily="ui-monospace, monospace">POST /api/v1/spend</text>
      <text x={-width / 2 + 14} y="-4" fill={colors.muted} fontSize="10" fontFamily="ui-monospace, monospace">recipient: 0xMerchant...</text>
      <text x={-width / 2 + 14} y="14" fill={colors.muted} fontSize="10" fontFamily="ui-monospace, monospace">amount: 12.50 USDC</text>
      <text x={-width / 2 + 14} y="32" fill={colors.muted} fontSize="10" fontFamily="ui-monospace, monospace">purpose: Vercel subscription</text>
    </g>
  );
}

function VerificationPanel({ phase, viewport }: { phase: number; viewport: Viewport }) {
  if (viewport === "mobile") return null;
  const x = viewport === "desktop" ? 660 : 195;
  const y = viewport === "desktop" ? 185 : 390;
  const checks = ["API key valid", "Agent matches policy", "Token + chain verified", "Amount within cap", "Replay check passed"];
  return (
    <g opacity={phase >= 2 ? 1 : .58} transform={`translate(${x} ${y})`}>
      <rect x="-112" y="-58" width="224" height="116" rx="8" fill={colors.surface} stroke={phase === 2 ? colors.purple : colors.outline} />
      <text x="-94" y="-35" fill={colors.purple} fontSize="10" fontFamily="ui-monospace, monospace">REQUEST VERIFICATION</text>
      {checks.map((check, index) => (
        <g key={check} transform={`translate(-94 ${-13 + index * 17})`}>
          <circle r="5" fill={phase > 2 ? colors.green : phase === 2 ? colors.purple : colors.outline} />
          {phase > 2 && <path d="m-2 0 2 2 4-4" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
          <text x="12" y="4" fill={colors.muted} fontSize="9" fontFamily="ui-monospace, monospace">{check}</text>
        </g>
      ))}
    </g>
  );
}

function VerdictPanel({ phase, viewport }: { phase: number; viewport: Viewport }) {
  const x = viewport === "desktop" ? 955 : 230;
  const y = viewport === "desktop" ? 510 : 765;
  const visible = phase >= 3;
  const width = viewport === "desktop" ? 264 : 286;
  return (
    <g opacity={visible ? 1 : .58} transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y="-36" width={width} height="72" rx="8" fill={colors.surface} stroke={phase > 3 ? colors.green : phase === 3 ? colors.amber : colors.outline} />
      <text x="0" y="-13" fill={phase > 3 ? colors.green : colors.amber} fontSize="11" fontFamily="ui-monospace, monospace" textAnchor="middle">{phase > 3 ? "VERDICT: APPROVED" : "COMPARATIVE REVIEW"}</text>
      <text x="0" y="6" fill={colors.muted} fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle">{phase > 3 ? "POLICY MATCH · RISK FLAGS: NONE" : "identity · amount · purpose · evidence"}</text>
      <text x="-58" y="25" fill={phase > 3 ? colors.green : colors.muted} fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle">APPROVE → EXECUTE</text>
      <text x="72" y="25" fill={colors.red} opacity={phase > 3 ? .38 : .7} fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle">DENY → STOP</text>
    </g>
  );
}

function AuditPanel({ phase, viewport }: { phase: number; viewport: Viewport }) {
  const x = viewport === "desktop" ? 1250 : 195;
  const y = viewport === "desktop" ? 600 : 1170;
  const visible = phase >= 6;
  return (
    <g opacity={visible ? 1 : .48} transform={`translate(${x} ${y})`}>
      <rect x={viewport === "desktop" ? -245 : -160} y="-28" width={viewport === "desktop" ? 490 : 320} height="56" rx="8" fill={colors.surface} stroke={visible ? colors.green : colors.outline} />
      <text x="0" y="-5" fill={visible ? colors.green : colors.muted} fontSize="10" fontFamily="ui-monospace, monospace" textAnchor="middle">ON-CHAIN AUDIT TRAIL UPDATED</text>
      <text x="0" y="15" fill={colors.muted} fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle">request · verdict · execution · tx hash</text>
    </g>
  );
}

export function TreasuryPaymentFlow() {
  const viewport = useViewport();
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [phase, setPhase] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const stages = viewport === "desktop" ? desktopStages : mobileStages;
  const viewBox = viewport === "desktop" ? "0 0 1600 700" : "0 0 390 1220";

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!rootRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .25 });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || reducedMotion) {
      if (reducedMotion) setPhase(6);
      return;
    }
    const timer = window.setTimeout(() => setPhase((current) => current >= 6 ? 0 : current + 1), phaseDurations[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, visible]);

  const packetPosition = useMemo(() => {
    const active = stages[Math.min(phase, 5)];
    return { x: active.x, y: active.y };
  }, [phase, stages]);

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(-4, Math.min(4, ((event.clientX - bounds.left) / bounds.width - .5) * 8)),
      y: Math.max(-3, Math.min(3, ((event.clientY - bounds.top) / bounds.height - .5) * 6)),
    });
  }

  function onPointerLeave() {
    setPointer({ x: 0, y: 0 });
  }

  const packetColor = phase === 3 ? colors.amber : phase >= 4 ? colors.green : colors.purple;

  return (
    <div ref={rootRef} className="payment-flow" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <svg viewBox={viewBox} role="img" aria-labelledby="payment-flow-title payment-flow-description">
        <title id="payment-flow-title">Treasury Copilot payment lifecycle</title>
        <desc id="payment-flow-description">An agent request moves from a bounded owner permission through verification, GenLayer review, 1Shot execution, and a Base USDC receipt.</desc>
        <g style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)`, transition: "transform 300ms ease-out" }}>
          {viewport === "desktop" ? (
            <line x1={stages[0].x + 48} y1={stages[0].y} x2={stages[5].x - 48} y2={stages[5].y} stroke={colors.outline} strokeWidth="2" />
          ) : (
            <line x1={stages[0].x} y1={stages[0].y + 48} x2={stages[5].x} y2={stages[5].y - 48} stroke={colors.outline} strokeWidth="2" />
          )}
          {stages.slice(0, -1).map((stage, index) => (
            <line
              key={stage.label}
              x1={viewport === "desktop" ? stage.x + 48 : stage.x}
              y1={viewport === "desktop" ? stage.y : stage.y + 48}
              x2={viewport === "desktop" ? stages[index + 1].x - 48 : stages[index + 1].x}
              y2={viewport === "desktop" ? stages[index + 1].y : stages[index + 1].y - 48}
              stroke={phase > index ? colors.green : colors.outline}
              strokeWidth={phase > index ? 3 : 2}
              opacity={phase > index ? 1 : .8}
            />
          ))}

          {stages.map((stage, index) => {
            const color = stageColor(index, phase);
            const active = phase === index;
            return (
              <g key={stage.label} transform={`translate(${stage.x} ${stage.y})`} opacity={phase >= index || index === 0 ? 1 : .82}>
                <circle r={active ? 48 : 44} fill={colors.surface} stroke={color} strokeWidth={active ? 3 : 2} className={active ? "flow-node-active" : ""} />
                <StageGlyph index={index} color={color} />
                <text x={viewport === "desktop" ? 0 : 66} y={viewport === "desktop" ? 68 : -15} fill={color} fontSize="11" fontWeight="700" fontFamily="ui-monospace, monospace" textAnchor={viewport === "desktop" ? "middle" : "start"}>{stage.label}</text>
                <text x={viewport === "desktop" ? 0 : 66} y={viewport === "desktop" ? 86 : 8} fill={colors.ink} fontSize={viewport === "desktop" ? 12 : 14} fontWeight="600" fontFamily="ui-sans-serif, sans-serif" textAnchor={viewport === "desktop" ? "middle" : "start"}>{stage.title}</text>
                <text x={viewport === "desktop" ? 0 : 66} y={viewport === "desktop" ? 103 : 29} fill={colors.muted} fontSize="10" fontFamily="ui-monospace, monospace" textAnchor={viewport === "desktop" ? "middle" : "start"}>{stage.detail}</text>
              </g>
            );
          })}

          <RequestPanel phase={phase} viewport={viewport} />
          <VerificationPanel phase={phase} viewport={viewport} />
          <ValidatorGroup phase={phase} viewport={viewport} />
          <VerdictPanel phase={phase} viewport={viewport} />
          <AuditPanel phase={phase} viewport={viewport} />

          <g transform={`translate(${packetPosition.x} ${packetPosition.y})`} style={{ transition: "transform 850ms cubic-bezier(.22,1,.36,1)" }} opacity={phase >= 1 ? 1 : .35}>
            <circle r="9" fill={packetColor} className="flow-packet" />
            <circle r="16" fill="none" stroke={packetColor} strokeWidth="1" opacity=".35" />
          </g>
        </g>
      </svg>
      <p className="sr-only" aria-live="polite">Current step: {phaseNames[phase]}</p>
    </div>
  );
}
