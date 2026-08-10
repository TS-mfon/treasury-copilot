import { ArrowDownRight, ArrowRight, Braces, CheckCircle2, FileCheck2, KeyRound, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import { Shell } from "@/components/Shell";
import { SetupAccessLink } from "@/components/SetupAccessLink";
import { PublicTransitionLink } from "@/components/PublicTransitionLink";
import { Reveal } from "@/components/Reveal";
import { TreasuryPaymentFlow } from "@/components/TreasuryPaymentFlow";
import { InteractiveHero, HeroMiniProof } from "@/components/InteractiveHero";

const safeguards = [
  { icon: KeyRound, title: "No agent private keys", detail: "Agents authenticate through scoped API keys that identify them but never sign blockchain transactions." },
  { icon: ShieldCheck, title: "Every request reviewed", detail: "Deterministic checks and GenLayer prompt comparative review evaluate every valid payment request." },
  { icon: RotateCcw, title: "Owner controlled revocation", detail: "Owners retain custody, policy control, API key rotation, and the ability to stop future execution." },
];

const lifecycle = [
  ["01", "REGISTER", "Owner permission, agent identity, policy limits, and a scoped API credential."],
  ["02", "REQUEST", "The agent submits recipient, amount, category, justification, and optional evidence through HTTP."],
  ["03", "REVIEW", "GenLayer determines whether the request satisfies the owner's policy and evidence requirements."],
  ["04", "RECEIPT", "Approved execution and the final transaction hash remain available in the audit trail."],
];

export default function Home() {
  return (
    <Shell>
      <InteractiveHero />

      <section className="story-intro" aria-labelledby="story-title">
        <div>
          <p className="eyebrow purple-text">THE GAP</p>
          <h2 id="story-title">Agents can reason. Their spending authority is still unsafe.</h2>
        </div>
        <div className="story-intro-copy">
          <p>Useful agents will need to buy APIs, data, compute, software, and services. A funded private key creates unrestricted exposure. Manual approval for every small payment removes the point of autonomy.</p>
          <p className="muted-copy">Treasury Copilot puts a policy boundary between agent intent and irreversible execution.</p>
          <HeroMiniProof />
        </div>
      </section>

      <Reveal id="payment-journey" className="story-section scroll-mt-20">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow purple-text">THE PAYMENT JOURNEY</p>
            <h2>One request. Four control states.</h2>
          </div>
          <p>From owner delegation to an auditable settlement, every step is explicit.</p>
        </div>
        <div className="journey-frame"><TreasuryPaymentFlow /></div>
      </Reveal>

      <Reveal className="story-section lifecycle-section">
        <div className="lifecycle-grid">
          {lifecycle.map(([number, title, detail]) => (
            <div className="lifecycle-item" key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="story-section story-section-split">
        <div className="section-heading-column">
          <p className="eyebrow green-text">REGISTER THE AGENT</p>
          <h2>Define authority before the first request arrives.</h2>
          <p className="muted-copy">The owner connects a wallet, grants bounded USDC permission, binds one agent to one policy, and receives a scoped `tcp_` credential.</p>
          <SetupAccessLink href="/setup" className="text-link">Open owner setup <ArrowRight size={16} /></SetupAccessLink>
        </div>
        <div className="registration-visual" aria-label="Agent registration stages">
          {["OWNER PERMISSION", "AGENT IDENTITY", "POLICY LIMITS", "SCOPED API KEY"].map((item, index) => (
            <div className="registration-step" key={item}>
              <span>0{index + 1}</span><strong>{item}</strong><i />
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="story-section story-section-split developer-story">
        <div className="section-heading-column">
          <p className="eyebrow amber-text">DEVELOPER EXPERIENCE</p>
          <h2>Agents integrate with JSON, not wallet infrastructure.</h2>
          <p className="muted-copy">The platform handles GenLayer submission, policy binding, finality, execution, and audit history behind a stable HTTP interface.</p>
          <PublicTransitionLink href="/agent" className="text-link">Explore the Agent API <ArrowRight size={16} /></PublicTransitionLink>
        </div>
        <div className="developer-console terminal">
          <div className="console-bar"><Braces size={14} /> POST /api/v1/spend <span>tcp_live_••••</span></div>
          <pre>{`{
  "agent_address": "0xRegisteredAgent...",
  "recipient": "0xApprovedMerchant...",
  "amount": "12.50",
  "category": "infrastructure",
  "justification": "Monthly deployment service",
  "idempotency_key": "deploy-2026-08"
}`}</pre>
          <div className="console-result"><span className="result-dot" /> request submitted <span className="console-result-id">request_id: 0x••••</span></div>
        </div>
      </Reveal>

      <Reveal className="story-section">
        <div className="section-heading-row">
          <div><p className="eyebrow red-text">THE TRUST BOUNDARY</p><h2>Useful autonomy without unrestricted custody.</h2></div>
          <p>The agent can ask. The policy decides. The owner can stop it.</p>
        </div>
        <div className="safeguard-grid">
          {safeguards.map((item) => (
            <div key={item.title} className="safeguard-item">
              <item.icon size={21} className="purple-text" />
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="story-section story-section-split audit-story">
        <div className="audit-copy"><FileCheck2 size={24} className="green-text" /><p className="eyebrow green-text">THE AUDIT TRAIL</p><h2>Every decision leaves evidence.</h2><p className="muted-copy">Request identity, policy version, verdict reasoning, execution state, and the final transaction hash remain available for review.</p></div>
        <div className="audit-list">
          {["REQUEST ACCEPTED", "GENLAYER REVIEW FINALIZED", "POLICY APPROVED", "EXECUTION CONFIRMED", "TX HASH RECORDED"].map((item, index) => <div key={item}><CheckCircle2 size={15} className={index === 4 ? "green-text" : "purple-text"} /><span>{item}</span><small>0{index + 1}</small></div>)}
        </div>
      </Reveal>

      <Reveal className="future-band">
        <div className="future-band-mark"><ArrowDownRight size={21} /></div>
        <p className="eyebrow purple-text">THE NEXT CONTROL PLANE</p>
        <h2>As agents become economically active, policy becomes infrastructure.</h2>
        <p className="muted-copy">Wallets handle custody. Payment networks handle settlement. Treasury Copilot governs why an agent is allowed to spend and records what happened.</p>
      </Reveal>

      <Reveal className="final-cta">
        <WalletCards className="purple-text" size={29} />
        <h2>Give your agents a budget, not your treasury.</h2>
        <p>Connect an owner wallet, grant bounded spending permission, define the policy, and issue an agent API key.</p>
        <div className="hero-actions final-actions"><SetupAccessLink href="/setup" className="hero-primary"><span>Start setup</span><ArrowRight size={16} /></SetupAccessLink><PublicTransitionLink href="/docs" className="hero-secondary"><span>Read the docs</span></PublicTransitionLink></div>
      </Reveal>
    </Shell>
  );
}
