import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { KokoroTTS } from "kokoro-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "marketing-kit", "04-video", "output");
const screenshots = path.join(root, "Screenshots");
const work = path.join(output, ".cinematic-work");
const W = 1920;
const H = 1080;
const FPS = 30;
const DESIGN_FPS = 8;
const AUDIO_TAIL = 0.55;
const voice = "af_bella";
const model = "onnx-community/Kokoro-82M-v1.0-ONNX";
const C = { black: "#000000", low: "#080808", high: "#121212", line: "#303030", ink: "#F5F5F5", body: "#C8C8C8", muted: "#858585", purple: "#A78BFA", green: "#4ADE80", amber: "#FBBF24", red: "#F87171", cyan: "#22D3EE" };
const font = "Liberation Sans,DejaVu Sans,Arial,sans-serif";
const mono = "DejaVu Sans Mono,Liberation Mono,monospace";

const campaigns = [
  {
    stem: "Treasury-Copilot-30s-Social-Pitch-V2",
    type: "social",
    scenes: [
      { id: "economy", duration: 5, label: "THE AGENT ECONOMY", title: ["Agents are beginning", "to buy resources."], subtitle: "APIs · data · compute · software", accent: "purple", narration: "AI agents are beginning to buy APIs, data, compute, and software." },
      { id: "risk", duration: 5, label: "THE SECURITY GAP", title: ["A funded wallet", "is not a policy."], subtitle: "Private-key access creates unrestricted exposure.", accent: "red", narration: "But a funded wallet gives the agent more authority than the owner intended." },
      { id: "boundary", duration: 5, label: "TREASURY COPILOT", title: ["Put policy between", "intent and funds."], subtitle: "The owner keeps custody and defines the boundary.", accent: "purple", narration: "Treasury Copilot puts a policy boundary between agent intent and human funds." },
      { id: "review", duration: 5, label: "CHECK + REVIEW", title: ["Hard limits first.", "GenLayer review next."], subtitle: "Identity · amount · recipient · purpose · evidence", accent: "amber", narration: "Hard limits are checked first. GenLayer then reviews whether the purpose matches the owner's policy." },
      { id: "outcome", duration: 5, label: "CONTROLLED EXECUTION", title: ["Approved moves.", "Unsafe stops."], subtitle: "Every outcome remains auditable.", accent: "green", narration: "Approved requests can execute. Unsafe requests stop, and every outcome remains auditable." },
      { id: "close", duration: 5, label: "TREASURY COPILOT", title: ["Give agents a budget.", "Not your private keys."], subtitle: "treasurycopilot.app", accent: "green", narration: "Give agents a budget, not your private keys. Build at Treasury Copilot dot app." },
    ],
  },
  {
    stem: "Treasury-Copilot-45s-Product-Journey",
    type: "product",
    scenes: [
      { id: "setup", duration: 8, label: "01 / OWNER SETUP", title: ["Define authority", "before autonomy."], subtitle: "Owner permission · agent identity · policy limits", accent: "purple", screenshot: "Screenshot 2026-08-01 152442.png", narration: "The owner connects a wallet, grants bounded test USDC permission, registers one agent, and defines exactly what that agent may request." },
      { id: "credential", duration: 7, label: "02 / REGISTRATION", title: ["One agent.", "One scoped credential."], subtitle: "A tcp key identifies the agent but never signs transactions.", accent: "cyan", narration: "Treasury Copilot verifies the registration, deploys the GenLayer policy, and issues a scoped API credential." },
      { id: "request", duration: 7, label: "03 / HTTP REQUEST", title: ["The agent sends intent,", "not a blockchain transaction."], subtitle: "Recipient · amount · purpose · evidence · idempotency", accent: "purple", code: "request", narration: "The agent sends a normal HTTP request with its recipient, amount, purpose, evidence, and idempotency key." },
      { id: "review", duration: 9, label: "04 / POLICY REVIEW", title: ["Deterministic limits meet", "prompt-comparative review."], subtitle: "Every valid request is checked against the owner's policy.", accent: "amber", narration: "Hard controls verify identity, token, caps, recipient, and replay state. GenLayer reviews whether the request satisfies the owner's policy." },
      { id: "decision", duration: 7, label: "05 / DECISION", title: ["Approved can execute.", "Denied moves no funds."], subtitle: "The policy boundary remains in control.", accent: "green", narration: "A finalized approval can enter execution. A denial stops before settlement, so no funds move." },
      { id: "history", duration: 7, label: "06 / AUDIT", title: ["The owner sees", "the complete outcome."], subtitle: "Verdict · reasoning · execution state · transaction hash", accent: "green", screenshot: "Screenshot 2026-08-01 152522.png", narration: "The owner can inspect the verdict, reasoning, execution state, and transaction receipt at Treasury Copilot dot app." },
    ],
  },
  {
    stem: "Treasury-Copilot-60s-Cinematic-Developer-Demo",
    type: "developer",
    scenes: [
      { id: "tree", duration: 8, label: "01 / AGENT PROJECT", title: ["Start with a small", "agent payment project."], subtitle: "billing-agent / policy / request / environment", accent: "purple", code: "tree", narration: "Start with a small agent project containing the policy configuration, payment request, and environment variables." },
      { id: "policy", duration: 10, label: "02 / POLICY CONFIG", title: ["Describe the agent's", "financial boundary."], subtitle: "This JSON mirrors values entered in the owner setup flow.", accent: "cyan", code: "policy", narration: "The policy JSON describes the agent address, Base Sepolia, test USDC limits, and the business purpose the owner allows." },
      { id: "register", duration: 10, label: "03 / REGISTER", title: ["Treasury Copilot verifies", "before issuing a key."], subtitle: "Permission · policy deployment · registry binding · readback", accent: "amber", code: "logs", narration: "During registration, Treasury Copilot validates the bounded permission, deploys the GenLayer policy, binds the owner and agent, reads the state back, and only then issues a scoped key." },
      { id: "curl", duration: 10, label: "04 / ONE API CALL", title: ["The agent requests", "payment through HTTP."], subtitle: "No wallet SDK · no gas logic · no agent private key", accent: "purple", code: "curl", narration: "The agent now requests payment with one HTTP call. It never receives the owner's private key or wallet permission data." },
      { id: "consensus", duration: 9, label: "05 / POLICY DECISION", title: ["Request submitted.", "GenLayer reviews."], subtitle: "Deterministic checks first · contextual policy second", accent: "amber", code: "response", narration: "The API returns a request ID. Deterministic controls run first, then GenLayer reviews whether the request matches policy." },
      { id: "receipt", duration: 8, label: "06 / OUTCOME", title: ["Approved execution.", "Auditable receipt."], subtitle: "Denied requests stop with no payment.", accent: "green", narration: "Approved requests can proceed to execution. Denied requests stop, and the complete outcome remains visible to the owner." },
      { id: "developer-close", duration: 5, label: "BUILD WITH TREASURY COPILOT", title: ["Give agents a budget.", "Keep control."], subtitle: "Docs and testnet flow: treasurycopilot.app", accent: "green", narration: "Build the first controlled agent payment at Treasury Copilot dot app." },
    ],
  },
  {
    stem: "Treasury-Copilot-Super-Developer-Promo",
    type: "super",
    scenes: [
      { id: "promo-setup", duration: 9, label: "01 / SETUP", title: ["Start with the real", "Treasury Copilot stack."], subtitle: "TreasuryPolicy.py · TreasuryRegistry.py · OpenAPI 3.1", accent: "purple", code: "promo-tree", narration: "Start with Treasury Copilot's policy contracts, registry, API specification, and the agent payment client that will call the service." },
      { id: "promo-define", duration: 11, label: "02 / DEFINE", title: ["Give one agent", "a precise boundary."], subtitle: "Agent identity · USDC caps · recipients · business purpose", accent: "cyan", code: "promo-policy", narration: "In the owner setup flow, register one agent and define its Base Sepolia USDC caps, approved recipients, and allowed business purpose." },
      { id: "promo-deploy", duration: 12, label: "03 / DEPLOY", title: ["Verify, deploy, bind,", "then issue access."], subtitle: "MetaMask permission · GenLayer deployment · registry readback", accent: "amber", code: "promo-logs", narration: "Treasury Copilot validates the owner's bounded MetaMask permission, deploys the GenLayer policy, binds the owner and agent in the registry, verifies the finalized state, and only then issues the scoped API key." },
      { id: "promo-initialize", duration: 11, label: "04 / INITIALIZE", title: ["Request payment with", "one authenticated call."], subtitle: "Intent enters through HTTPS, never through an agent private key", accent: "purple", code: "promo-curl", narration: "The agent initializes a payment request with one authenticated HTTPS call, including the recipient, amount, purpose, evidence, and a stable idempotency key." },
      { id: "promo-result", duration: 12, label: "05 / RESULT", title: ["Policy approved.", "Execution recorded."], subtitle: "Request ID · verdict · reasoning · transaction receipt", accent: "green", code: "promo-result", narration: "Treasury Copilot returns the request ID immediately. GenLayer reviews the intent, approved execution proceeds through the constrained permission, and the owner receives a complete auditable receipt." },
      { id: "promo-close", duration: 6, label: "TREASURY COPILOT", title: ["Financial control", "for autonomous agents."], subtitle: "Build on testnet at treasurycopilot.app", accent: "green", narration: "Give agents useful spending power without giving away control. Build at Treasury Copilot dot app." },
    ],
  },
];

function esc(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function color(name) { return C[name] ?? C.purple; }
function textLines(lines, x, y, size, fill, weight = 700, leading = 1.12, family = font) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * size * leading}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}">${esc(line)}</text>`).join("");
}
function hologramPanel(x, y, w, h, accent, inner = "") {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#080808" fill-opacity=".9" stroke="${accent}" stroke-opacity=".7" stroke-width="2"/><rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}" rx="6" fill="none" stroke="#303030"/><path d="M${x} ${y + 46}H${x + w}" stroke="${accent}" stroke-opacity=".5"/><circle cx="${x + 24}" cy="${y + 23}" r="4" fill="${C.red}"/><circle cx="${x + 39}" cy="${y + 23}" r="4" fill="${C.amber}"/><circle cx="${x + 54}" cy="${y + 23}" r="4" fill="${C.green}"/>${inner}</g>`;
}
function codeBlock(kind, x, y, reveal = 1) {
  const lines = {
    tree: ["billing-agent/", "├── agent-policy.json", "├── payment-request.json", "├── request-payment.sh", "└── .env"],
    policy: ["{", "  \"agent_address\": \"0xAgent...\",", "  \"chain\": \"baseSepolia\",", "  \"token\": \"USDC\",", "  \"weekly_cap\": \"100.00\",", "  \"per_transaction_cap\": \"25.00\",", "  \"policy\": \"Allow specific API", "    and software expenses.\"", "}"],
    logs: ["$ treasury setup", "[owner] permission validated", "[policy] deploying GenLayer policy", "[registry] binding owner + agent", "[verify] registration state confirmed", "[key] scoped tcp_ credential issued"],
    curl: ["curl -X POST \\", "  https://treasurycopilot.app/api/v1/spend \\", "  -H \"Authorization: Bearer $TREASURY_API_KEY\" \\", "  -H \"Content-Type: application/json\" \\", "  -d @payment-request.json"],
    response: ["HTTP/2 202", "{", "  \"request_id\": \"0x7af...\",", "  \"verdict\": \"pending\",", "  \"status\": \"submitted\",", "  \"decision_mode\": \"prompt_comparative\"", "}"],
    request: ["POST /api/v1/spend", "Authorization: Bearer tcp_••••", "", "recipient: 0xApprovedMerchant", "amount: \"12.50\"", "category: infrastructure", "idempotency_key: deploy-2026-08"],
    "promo-tree": ["treasury-copilot/", "├── contracts/genlayer/TreasuryPolicy.py", "├── contracts/genlayer/TreasuryRegistry.py", "├── apps/web/public/openapi.json", "└── agent-client/request-payment.sh"],
    "promo-policy": ["OWNER SETUP", "agent: 0xAgent...", "network: Base Sepolia", "token: USDC", "weekly cap: 100.00", "request cap: 25.00", "recipients: approved only", "purpose: APIs + infrastructure"],
    "promo-logs": ["[permission] MetaMask boundary verified", "[policy] TreasuryPolicy.py deployed", "[registry] owner + agent binding submitted", "[finality] GenLayer state finalized", "[readback] exact policy binding confirmed", "[access] scoped tcp_ key issued once"],
    "promo-curl": ["curl -X POST treasurycopilot.app/api/v1/spend \\", "  -H \"Authorization: Bearer $TREASURY_API_KEY\" \\", "  -H \"Content-Type: application/json\" \\", "  -d '{", "    \"recipient\": \"0xApprovedMerchant\",", "    \"amount\": \"12.50\",", "    \"category\": \"infrastructure\",", "    \"idempotency_key\": \"deploy-2026-08\"", "  }'"],
    "promo-result": ["HTTP/2 202 Accepted", "request_id: 0x7af...", "verdict: approved", "decision_mode: prompt_comparative", "execution_status: executed", "tx_hash: 0x91c...", "receipt: recorded on GenLayer"],
  }[kind] ?? [];
  const visible = Math.max(1, Math.ceil(lines.length * Math.min(1, Math.max(0, reveal))));
  return lines.map((line, index) => {
    if (index >= visible) return "";
    const opacity = Math.min(1, Math.max(0, reveal * lines.length - index));
    return `<text x="${x}" y="${y + index * 34}" fill="${index === 0 ? C.green : C.body}" fill-opacity="${opacity.toFixed(3)}" font-family="${mono}" font-size="${kind === "curl" ? 17 : 19}">${esc(line)}</text>`;
  }).join("");
}
function sentinel(cx, cy, accent, blocked = false) {
  return `<g transform="translate(${cx} ${cy})"><circle r="160" fill="#0b0b0b" stroke="${accent}" stroke-width="5"/><path d="M-72-90H72V0c0 70-35 116-72 137-37-21-72-67-72-137v-90Z" fill="#080808" stroke="${accent}" stroke-width="9"/><path d="M-35-108H35" stroke="${blocked ? C.red : C.amber}" stroke-width="9" stroke-linecap="round"/>${blocked ? `<path d="m-40-25 80 80M40-25l-80 80" stroke="${C.red}" stroke-width="14" stroke-linecap="round"/>` : `<path d="m-42 8 28 28 58-68" stroke="${accent === C.amber ? C.amber : C.green}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`}</g>`;
}
function flowVisual(accent, sceneId, progress = 0.5) {
  const nodes = [[1120, 480, "API"], [1325, 480, "CHECK"], [1530, 480, "REVIEW"], [1735, 480, "USDC"]];
  const packetX = 1120 + Math.min(1, Math.max(0, progress)) * 615;
  const pulse = 0.65 + 0.35 * Math.sin(progress * Math.PI * 8);
  const blocked = sceneId === "risk";
  return `<path d="M1120 480H1735" stroke="#333" stroke-width="7"/><path d="M1120 480H${packetX.toFixed(1)}" stroke="${accent}" stroke-width="7" stroke-linecap="round" opacity=".75"/><circle cx="${packetX.toFixed(1)}" cy="480" r="13" fill="${accent}" opacity="${pulse.toFixed(3)}"/><circle cx="${packetX.toFixed(1)}" cy="480" r="28" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="3"/>${nodes.map(([x, y, label], i) => { const reached = x <= packetX + 30; const nodeColor = i < 2 ? C.purple : i === 2 ? C.amber : C.green; return `<g opacity="${reached ? 1 : .62}"><circle cx="${x}" cy="${y}" r="62" fill="#0a0a0a" stroke="${nodeColor}" stroke-width="${reached ? 8 : 5}"/><text x="${x}" y="${y + 7}" text-anchor="middle" fill="${nodeColor}" font-family="${mono}" font-size="18" font-weight="700">${label}</text></g>`; }).join("")}${sentinel(1530, 715, blocked ? C.red : accent, blocked)}`;
}
const screenshotCache = new Map();
async function screenshotData(name) {
  if (!name) return null;
  if (screenshotCache.has(name)) return screenshotCache.get(name);
  const data = await fs.readFile(path.join(screenshots, name));
  const encoded = data.toString("base64");
  screenshotCache.set(name, encoded);
  return encoded;
}
function screenshotPanel(data, accent, progress = 0.5) {
  if (!data) return "";
  const drift = (progress - 0.5) * 22;
  const scanY = 270 + Math.abs(Math.sin(progress * Math.PI * 2)) * 440;
  return `<g><rect x="1030" y="230" width="770" height="540" rx="12" fill="#090909" stroke="${accent}" stroke-width="3"/><rect x="1050" y="250" width="730" height="500" fill="${accent}" opacity=".035"/><rect x="1050" y="${scanY.toFixed(1)}" width="730" height="2" fill="${accent}" opacity=".55"/><text x="1080" y="285" fill="${accent}" font-family="${mono}" font-size="14" letter-spacing="2">LIVE PRODUCT SURFACE</text></g>`;
}
async function sceneSvg(campaign, scene, index, timelineProgress, shot) {
  const accent = color(scene.accent);
  const intro = Math.min(1, timelineProgress / 0.18);
  const outro = Math.max(0, (timelineProgress - 0.86) / 0.14);
  const reveal = Math.min(1, Math.max(0, (timelineProgress - 0.12) / 0.48));
  const campaignProgress = ((index + timelineProgress) / campaign.scenes.length) * 1600;
  let visual = "";
  if (shot) visual = screenshotPanel(shot, accent, timelineProgress);
  else if (scene.code) visual = hologramPanel(1040 + (1 - intro) * 90, 210, 750, 570, accent, codeBlock(scene.code, 1090 + (1 - intro) * 90, 305, reveal));
  else visual = flowVisual(accent, scene.id, 0.08 + reveal * 0.84);
  const titleX = 110 + (1 - intro) * -80;
  const titleOpacity = Math.min(1, intro) * (1 - outro * 0.3);
  const backgroundShift = (timelineProgress * 64).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="glow"><stop offset="0" stop-color="${accent}" stop-opacity=".22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse" x="${backgroundShift}" y="${backgroundShift}"><path d="M64 0H0V64" fill="none" stroke="${accent}" stroke-opacity=".07"/></pattern><clipPath id="screenClip"><rect x="1050" y="250" width="730" height="500" rx="4"/></clipPath></defs><rect width="1920" height="1080" fill="${C.black}"/><rect width="1920" height="1080" fill="url(#grid)"/><circle cx="1460" cy="490" r="560" fill="url(#glow)" opacity="${(0.72 + Math.sin(timelineProgress * Math.PI * 2) * 0.15).toFixed(3)}"/><g opacity="${titleOpacity.toFixed(3)}"><text x="${titleX.toFixed(1)}" y="130" fill="${accent}" font-family="${mono}" font-size="20" font-weight="700">${esc(scene.label)}</text>${textLines(scene.title, titleX, 300, 70, C.ink, 700, 1.12)}<text x="${titleX}" y="${300 + scene.title.length * 79 + 34}" fill="${C.muted}" font-family="${font}" font-size="28">${esc(scene.subtitle)}</text></g>${visual}<rect x="110" y="950" width="1600" height="4" fill="#282828"/><rect x="110" y="950" width="${campaignProgress.toFixed(1)}" height="4" fill="${accent}"/><text x="110" y="1005" fill="${C.muted}" font-family="${mono}" font-size="18">TREASURY COPILOT / POLICY · REVIEW · EXECUTION · AUDIT</text><text x="1710" y="1005" text-anchor="end" fill="${C.ink}" font-family="${mono}" font-size="18">treasurycopilot.app</text></svg>`;
}
function ffmpeg(args) { const result = spawnSync("ffmpeg", args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr || "ffmpeg failed"); }
function probeDuration(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "ffprobe failed");
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not read duration for ${file}`);
  return duration;
}
let tts;
async function synthesize(text, rawPath, finalPath) {
  if (!tts) tts = await KokoroTTS.from_pretrained(model, { dtype: "q8", device: "cpu" });
  const audio = await tts.generate(text, { voice });
  await audio.save(rawPath);
  ffmpeg(["-i", rawPath, "-af", `aresample=44100,highpass=f=85,acompressor=threshold=0.10:ratio=2.2:attack=12:release=160:makeup=1.4,loudnorm=I=-18:LRA=7:TP=-3,apad=pad_dur=${AUDIO_TAIL}`, "-ar", "44100", "-ac", "2", "-y", finalPath]);
  return probeDuration(finalPath);
}
async function render(campaign) {
  const dir = path.join(work, campaign.stem);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const pieces = [];
  const renderedScenes = [];
  for (let i = 0; i < campaign.scenes.length; i += 1) {
    const scene = campaign.scenes[i];
    const prefix = String(i + 1).padStart(2, "0");
    const frames = path.join(dir, `${prefix}-frames`);
    const rawAudio = path.join(dir, `${prefix}-raw.wav`);
    const audio = path.join(dir, `${prefix}.wav`);
    const visual = path.join(dir, `${prefix}-visual.mp4`);
    const piece = path.join(dir, `${prefix}.mp4`);
    const audioDuration = await synthesize(scene.narration, rawAudio, audio);
    const actualDuration = Math.max(scene.duration, audioDuration);
    const frameCount = Math.max(2, Math.ceil(actualDuration * DESIGN_FPS));
    const shot = await screenshotData(scene.screenshot);
    await fs.mkdir(frames, { recursive: true });
    for (let frame = 0; frame < frameCount; frame += 1) {
      const timelineProgress = frame / Math.max(1, frameCount - 1);
      const framePath = path.join(frames, `${String(frame).padStart(5, "0")}.png`);
      const frameImage = sharp(Buffer.from(await sceneSvg(campaign, scene, i, timelineProgress, shot)));
      if (scene.screenshot) {
        const screenshotBuffer = await sharp(path.join(screenshots, scene.screenshot)).resize(730, 500, { fit: "cover" }).png().toBuffer();
        frameImage.composite([{ input: screenshotBuffer, left: 1050, top: 250 }]);
      }
      await frameImage.png().toFile(framePath);
    }
    ffmpeg(["-framerate", String(DESIGN_FPS), "-i", path.join(frames, "%05d.png"), "-vf", `fps=${FPS},format=yuv420p`, "-r", String(FPS), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-y", visual]);
    ffmpeg(["-i", visual, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-y", piece]);
    pieces.push(piece);
    renderedScenes.push({ ...scene, target_duration_seconds: scene.duration, audio_duration_seconds: Number(audioDuration.toFixed(3)), actual_duration_seconds: Number(probeDuration(piece).toFixed(3)) });
    console.log(`[${campaign.stem}] rendered ${scene.id} (${renderedScenes.at(-1).actual_duration_seconds}s)`);
  }
  const concat = path.join(dir, "concat.txt");
  await fs.writeFile(concat, pieces.map((piece) => `file '${piece}'`).join("\n") + "\n");
  const final = path.join(output, `${campaign.stem}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", "-movflags", "+faststart", "-y", final]);
  const duration = probeDuration(final);
  await fs.writeFile(path.join(output, `${campaign.stem}-manifest.json`), JSON.stringify({ generated_at: new Date().toISOString(), type: campaign.type, width: W, height: H, fps: FPS, design_fps: DESIGN_FPS, duration_seconds: Number(duration.toFixed(3)), voice, subtitles: false, canonical_url: "https://treasurycopilot.app", scenes: renderedScenes }, null, 2) + "\n");
  await fs.writeFile(path.join(output, `${campaign.stem}-narration.txt`), campaign.scenes.map((scene) => `[${scene.id}]\n${scene.narration}`).join("\n\n") + "\n");
  ffmpeg(["-i", final, "-vf", `fps=1/${campaign.type === "social" ? 5 : 8},scale=420:-1,tile=${campaign.scenes.length}x1`, "-frames:v", "1", "-update", "1", "-y", path.join(output, `${campaign.stem}-contact-sheet.png`)]);
}

await fs.mkdir(output, { recursive: true });
await fs.mkdir(work, { recursive: true });
const requestedCampaign = process.env.VIDEO_CAMPAIGN?.trim();
const selectedCampaigns = requestedCampaign ? campaigns.filter((campaign) => campaign.stem === requestedCampaign) : campaigns;
if (selectedCampaigns.length === 0) throw new Error(`Unknown VIDEO_CAMPAIGN: ${requestedCampaign}`);
for (const campaign of selectedCampaigns) await render(campaign);
await fs.rm(work, { recursive: true, force: true });
console.log(`Rendered ${selectedCampaigns.length} cinematic Treasury Copilot video${selectedCampaigns.length === 1 ? "" : "s"}.`);
