import { escapeXml, formatTokens, relativeTime, truncate } from "./format.js";
import type { CodexThread, DashboardSnapshot } from "./model.js";
import type { PetHomeTravel } from "./pet-roamer.js";
import { animationFrame, petPose, petSpriteDataUri } from "./pet-sprite.js";

export type PetMood = "coding" | "ready" | "sleeping" | "worried" | "confused";

export type PetView = {
  mood: PetMood;
  label: string;
  accent: string;
  title: string;
  meta: string;
  progress: number;
  thread: CodexThread | null;
  position: number;
  total: number;
};

export function petView(snapshot: DashboardSnapshot, requestedIndex = 0): PetView {
  const total = snapshot.threads.length;
  const position = total ? ((requestedIndex % total) + total) % total : 0;
  const thread = snapshot.threads[position] ?? null;
  const blocked = snapshot.goals.some((goal) => goal.status === "blocked");
  const active = snapshot.activeProcesses > 0;

  const mood: PetMood = snapshot.dataError
    ? "confused"
    : blocked
      ? "worried"
      : active
        ? "coding"
        : total
          ? "ready"
          : "sleeping";
  const appearance = {
    coding: { label: "CODING", accent: "#32d49a", progress: 100 },
    ready: { label: "READY", accent: "#60a5fa", progress: 68 },
    sleeping: { label: "NAPPING", accent: "#8b9bb4", progress: 24 },
    worried: { label: "CHECK GOAL", accent: "#f5a623", progress: 46 },
    confused: { label: "NEEDS HELP", accent: "#ef6b73", progress: 18 }
  }[mood];

  const title = thread?.title ?? (mood === "confused" ? "Local data unavailable" : "No tasks yet");
  const meta = thread
    ? `${formatTokens(thread.tokensUsed)} tokens · ${relativeTime(thread.updatedAtMs)}`
    : mood === "sleeping"
      ? "press to start a task"
      : "press to open Codex";

  return { mood, ...appearance, title, meta, thread, position, total };
}

const HOME_TRAVEL: PetHomeTravel = {
  phase: "home",
  edge: "left",
  elapsedMs: 0,
  durationMs: 0
};

export function petPanelSvg(view: PetView, nowMs = Date.now(), travel: PetHomeTravel = HOME_TRAVEL): string {
  return petSceneSvg(view, 0, nowMs, travel);
}

export function petDetailSvg(view: PetView, nowMs = Date.now(), travel: PetHomeTravel = HOME_TRAVEL): string {
  return petSceneSvg(view, 1, nowMs, travel);
}

export function petKeySvg(view: PetView, nowMs = Date.now()): string {
  const pose = petPose(view.mood, nowMs);
  const sprite = petSpriteDataUri(pose.state, pose.frame);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="22" fill="#081019"/>
  <rect width="144" height="7" rx="3.5" fill="${view.accent}"/>
  <image href="${sprite}" x="7" y="2" width="130" height="141" preserveAspectRatio="xMidYMid meet"/>
  <rect x="10" y="113" width="124" height="23" rx="7" fill="#081019" opacity=".88"/>
  <text x="72" y="129" text-anchor="middle" fill="${view.accent}" font-family="-apple-system,Arial" font-size="12" font-weight="800" letter-spacing=".7">${escapeXml(view.label)}</text>
  </svg>`;
}

function petSceneSvg(view: PetView, panel: 0 | 1, nowMs: number, travel: PetHomeTravel): string {
  const pose = petPose(view.mood, nowMs);
  const sprite = petSpriteDataUri(pose.state, pose.frame);
  const taskCounter = view.total ? `${view.position + 1}/${view.total}` : "--";
  const title = truncate(view.title, 28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="${panel * 200} 0 200 100">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07101b"/><stop offset="1" stop-color="#0d1b2a"/></linearGradient>
  </defs>
  <rect width="400" height="100" fill="url(#sky)"/>
  <rect width="400" height="4" fill="${view.accent}"/>
  <circle cx="32" cy="49" r="1" fill="#38506a"/><circle cx="137" cy="66" r="1.4" fill="#29445e"/><circle cx="233" cy="52" r="1" fill="#38506a"/><circle cx="351" cy="72" r="1.3" fill="#29445e"/>
  <path d="M0 95.5h400M20 82h42m75 7h54m83-4h78" stroke="#23384c" stroke-width="1" stroke-linecap="round"/>
  ${travel.phase === "home"
    ? `<image href="${sprite}" x="${pose.x.toFixed(2)}" y="${pose.y.toFixed(2)}" width="86" height="93" preserveAspectRatio="xMidYMid meet"/>`
    : travel.phase === "away"
      ? petAwayStatusSvg(view.accent, nowMs, travel)
      : petHomeTravelSvg(travel, view.mood, nowMs)}
  <rect x="7" y="7" width="188" height="27" rx="7" fill="#081019" opacity=".84"/>
  <text x="13" y="19" fill="#93a6bd" font-family="-apple-system,Arial" font-size="9" font-weight="800" letter-spacing="1">CODEX PET</text>
  <text x="13" y="30" fill="${view.accent}" font-family="-apple-system,Arial" font-size="10" font-weight="800">${escapeXml(view.label)}</text>
  <text x="184" y="24" text-anchor="end" fill="#93a6bd" font-family="-apple-system,Arial" font-size="9" font-weight="700">TASK ${taskCounter}</text>
  <rect x="205" y="7" width="188" height="27" rx="7" fill="#081019" opacity=".84"/>
  <text x="212" y="19" fill="#f3f7fb" font-family="-apple-system,Arial" font-size="10" font-weight="750">${escapeXml(title)}</text>
  <text x="212" y="30" fill="#93a6bd" font-family="-apple-system,Arial" font-size="9" font-weight="650">${escapeXml(truncate(view.meta, 34))}</text>
  <rect x="7" y="96" width="386" height="2" rx="1" fill="#1d2b3a"/>
  <rect x="7" y="96" width="${3.86 * view.progress}" height="2" rx="1" fill="${view.accent}"/>
  </svg>`;
}

function petAwayStatusSvg(accent: string, nowMs: number, travel: PetHomeTravel): string {
  const angle = Math.round(nowMs / 24) % 360;
  const fadeMs = Math.min(500, travel.durationMs / 4);
  const fadeIn = smoothstep(Math.max(0, Math.min(1, travel.elapsedMs / Math.max(1, fadeMs))));
  const fadeOut = smoothstep(Math.max(0, Math.min(1, (travel.durationMs - travel.elapsedMs) / Math.max(1, fadeMs))));
  const reveal = Math.min(fadeIn, fadeOut);
  const opacity = (reveal * (0.88 + Math.sin(nowMs / 700) * 0.06)).toFixed(2);
  const stop = travel.destination === "screen" ? "STRIP CHECK-IN" : "TILE CHECK-IN";
  const dots = [0, 1, 2].map((index) => {
    const dotOpacity = (0.25 + (Math.sin(nowMs / 240 - index * 1.4) + 1) * 0.375).toFixed(2);
    return `<circle cx="${344 + index * 11}" cy="66" r="2.5" fill="${accent}" opacity="${dotOpacity}"/>`;
  }).join("");
  return `<g class="pet-away-status" opacity="${opacity}">
    <rect x="22" y="48" width="356" height="36" rx="18" fill="#081019" fill-opacity=".88" stroke="${accent}" stroke-width="1.25" stroke-opacity=".55"/>
    <circle cx="43" cy="66" r="9" fill="#0d1b2a" stroke="${accent}" stroke-width="1.25"/>
    <path d="M43 57.5L46.5 66L43 74.5L39.5 66Z" fill="${accent}" transform="rotate(${angle} 43 66)"/>
    <circle cx="43" cy="66" r="1.5" fill="#f3f7fb"/>
    <text x="60" y="62" fill="#718399" font-family="-apple-system,Arial" font-size="7" font-weight="800" letter-spacing="1">CODEX IS</text>
    <text x="60" y="74" fill="${accent}" font-family="-apple-system,Arial" font-size="10" font-weight="800" letter-spacing=".65">OUT EXPLORING</text>
    <rect x="199" y="55" width="1" height="22" fill="#29445e"/>
    <text x="216" y="62" fill="#718399" font-family="-apple-system,Arial" font-size="7" font-weight="800" letter-spacing="1">CURRENT STOP</text>
    <text x="216" y="74" fill="#f3f7fb" font-family="-apple-system,Arial" font-size="10" font-weight="800" letter-spacing=".55">${stop}</text>
    ${dots}
  </g>`;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function petHomeTravelSvg(travel: PetHomeTravel, mood: PetMood, nowMs: number): string {
  const progress = Math.max(0, Math.min(1, travel.elapsedMs / Math.max(1, travel.durationMs)));
  const eased = progress * progress * (3 - 2 * progress);
  const homeTime = travel.phase === "departing"
    ? nowMs - travel.elapsedMs
    : nowMs + travel.durationMs - travel.elapsedMs;
  const homeX = petPose(mood, homeTime).x;
  const outsideX = travel.edge === "left" ? -88 : 402;
  const x = travel.phase === "departing"
    ? lerp(homeX, outsideX, eased)
    : lerp(outsideX, homeX, eased);
  const state = travel.phase === "departing"
    ? travel.edge === "left" ? "running-left" : "running-right"
    : travel.edge === "left" ? "running-right" : "running-left";
  const sprite = petSpriteDataUri(state, animationFrame(state, travel.elapsedMs));
  return `<g class="pet-home-travel">
    <image href="${sprite}" x="${x.toFixed(2)}" y="12" width="86" height="93" preserveAspectRatio="xMidYMid meet"/>
  </g>`;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
