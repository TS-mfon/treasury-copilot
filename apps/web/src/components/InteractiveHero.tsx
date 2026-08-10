"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowRight, Check, Code2, ShieldCheck, X } from "lucide-react";
import { SetupAccessLink } from "@/components/SetupAccessLink";
import { PublicTransitionLink } from "@/components/PublicTransitionLink";

type PanelProps = {
  position: [number, number, number];
  rotation?: [number, number, number];
  accent: string;
  label: string;
  title: string;
  lines: string[];
  scale: number;
};

function Panel({ position, rotation = [0, 0, 0], accent, label, title, lines, scale }: PanelProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <planeGeometry args={[3.2, 2.1]} />
        <meshBasicMaterial color="#080808" transparent opacity={0.96} />
      </mesh>
      <Line points={[[-1.6, 1.05, 0.02], [1.6, 1.05, 0.02], [1.6, -1.05, 0.02], [-1.6, -1.05, 0.02], [-1.6, 1.05, 0.02]]} color="#343434" lineWidth={1} />
      <Line points={[[-1.5, 0.82, 0.03], [1.5, 0.82, 0.03]]} color={accent} lineWidth={1.2} />
      <Html transform position={[-1.38, 0.62, 0.05]} distanceFactor={5} style={{ width: 220, pointerEvents: "none" }}>
        <div className="hero-panel-copy" style={{ "--panel-accent": accent } as React.CSSProperties}>
          <span className="hero-panel-label">{label}</span>
          <strong>{title}</strong>
          <div className="hero-panel-lines">
            {lines.map((line) => <span key={line}>{line}</span>)}
          </div>
        </div>
      </Html>
    </group>
  );
}

function Sentinel({ progress }: { progress: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.18;
    group.current.position.y = Math.sin(performance.now() / 1200) * 0.08;
  });

  const accent = progress > 0.56 ? "#4ade80" : progress > 0.32 ? "#fbbf24" : "#a78bfa";
  return (
    <group ref={group} position={[0.05, 0.12, 0.4]} scale={0.7}>
      <mesh>
        <octahedronGeometry args={[0.95, 1]} />
        <meshBasicMaterial color="#111111" wireframe transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[1.1, 1.1, 0.08]} />
        <meshBasicMaterial color={accent} wireframe transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.3]}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  );
}

function RequestPacket({ progress }: { progress: number }) {
  const packet = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!packet.current) return;
    const loop = (performance.now() / 5200) % 1;
    const x = -2.9 + loop * 5.8;
    packet.current.position.x = x;
    packet.current.position.y = 0.25 + Math.sin(loop * Math.PI * 2) * 0.08;
    packet.current.scale.setScalar(loop > 0.5 && progress > 0.55 ? 1.25 : 1);
  });
  return (
    <mesh ref={packet} position={[-2.9, 0.25, 0.5]}>
      <sphereGeometry args={[0.09, 16, 16]} />
      <meshBasicMaterial color={progress > 0.55 ? "#4ade80" : "#a78bfa"} />
    </mesh>
  );
}

function HeroScene({ progress, reducedMotion }: { progress: number; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const { size } = useThree();
  const compact = size.width < 700;

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      target.current.x = ((event.clientX / window.innerWidth) - 0.5) * 0.32;
      target.current.y = ((event.clientY / window.innerHeight) - 0.5) * 0.22;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => window.removeEventListener("pointermove", onPointer);
  }, []);

  useFrame((_, delta) => {
    if (!root.current) return;
    const damp = reducedMotion ? 1 : 1 - Math.pow(0.001, delta);
    pointer.current.x = THREE.MathUtils.lerp(pointer.current.x, target.current.x, damp);
    pointer.current.y = THREE.MathUtils.lerp(pointer.current.y, target.current.y, damp);
    root.current.rotation.x = reducedMotion ? 0 : pointer.current.y;
    root.current.rotation.y = reducedMotion ? 0.08 : 0.08 + pointer.current.x;
    root.current.position.y = THREE.MathUtils.lerp(root.current.position.y, progress * -0.9, damp);
    root.current.scale.setScalar(THREE.MathUtils.lerp(root.current.scale.x, 1 - progress * 0.2, damp));
  });

  const panelScale = compact ? 0.78 : 1;
  return (
    <group ref={root}>
      <Sparkles count={compact ? 30 : 70} scale={[8, 5, 3]} size={1.5} speed={0.25} color="#a78bfa" opacity={0.25} />
      <Panel position={[-1.22, 0.2, -0.15]} rotation={[0, 0.08, -0.04]} accent="#a78bfa" label="01 / SETUP" title="Owner permission" lines={["USDC / Base Sepolia", "bounded weekly cap", "revocable authority"]} scale={panelScale} />
      <Panel position={[1.22, 0.35, -0.4]} rotation={[0, -0.08, 0.04]} accent="#fbbf24" label="02 / REVIEW" title="GenLayer policy" lines={["prompt comparative", "context + evidence", "approved / blocked"]} scale={panelScale} />
      <Panel position={[0.98, -1.05, -0.1]} rotation={[0, -0.02, -0.03]} accent="#4ade80" label="03 / HISTORY" title="Auditable receipt" lines={["execution confirmed", "request ID recorded", "transaction hash"]} scale={panelScale * 0.9} />
      <Sentinel progress={progress} />
      <RequestPacket progress={progress} />
    </group>
  );
}

export function InteractiveHero() {
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    const onScroll = () => setProgress(Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.9)));
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      media.removeEventListener("change", update);
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
        <p>Give agents a budget, not your private keys. Treasury Copilot turns an agent payment request into a bounded, policy-reviewed, auditable outcome.</p>
        <div className="hero-actions">
          <SetupAccessLink href="/setup" className="hero-primary"><span>Configure an agent</span><ArrowRight size={16} /></SetupAccessLink>
          <PublicTransitionLink href="/docs" className="hero-secondary"><Code2 size={16} /><span>Read the API</span></PublicTransitionLink>
        </div>
        <div className="hero-proof-row"><span>BASE SEPOLIA USDC</span><span>GENLAYER REVIEW</span><span>ERC-7715 BOUNDS</span></div>
      </div>
      <div className="hero-canvas-wrap" style={{ transform: `translate3d(0, ${progress * 90}px, 0)` }}>
        <Canvas camera={{ position: [0, 0, 7], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
          <color attach="background" args={["#000000"]} />
          <ambientLight intensity={0.8} />
          <HeroScene progress={progress} reducedMotion={reducedMotion} />
          <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} />
        </Canvas>
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
