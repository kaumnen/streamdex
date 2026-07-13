import { escapeXml, formatTokens, relativeTime, truncate, usageForRange } from "./format.js";
import type { CodexGoal, DashboardSnapshot, RateLimitWindow } from "./model.js";

export type ConsoleGroup = "usage" | "status";

export type ConsoleScene = {
  label: string;
  title: string;
  detail: string;
  support: string;
  accent: string;
  progress: number;
  live?: boolean;
  position: number;
  count: number;
};

const USAGE_RANGES = [1, 7, 30, 0] as const;

export function consoleSceneCount(group: ConsoleGroup, snapshot: DashboardSnapshot): number {
  return group === "usage" ? USAGE_RANGES.length : statusScenes(snapshot).length;
}

export function consoleScene(
  group: ConsoleGroup,
  index: number,
  snapshot: DashboardSnapshot,
  nowMs = Date.now()
): ConsoleScene {
  const scenes = group === "usage" ? usageScenes(snapshot) : statusScenes(snapshot, nowMs);
  return scenes[normalize(index, scenes.length)]!;
}

export function consolePanelSvg(scene: ConsoleScene, panel: number): string {
  const viewX = normalize(panel, 2) * 200;
  const titleLines = wrapTitle(truncate(scene.title, 72), 38);
  const multiline = titleLines.length > 1;
  const fontSize = multiline ? 17 : scene.title.length > 28 ? 20 : 25;
  const titleText = titleLines.map((line, index) =>
    `<text x="12" y="${multiline ? 41 + index * 18 : 49}" fill="#f6f9fd" font-family="-apple-system,Arial" font-size="${fontSize}" font-weight="760">${escapeXml(line)}</text>`
  ).join("");
  const progress = Math.max(0, Math.min(100, scene.progress));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="${viewX} 0 200 100">
  <defs>
    <linearGradient id="console-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111b"/>
      <stop offset=".52" stop-color="#0c1b2a"/>
      <stop offset="1" stop-color="#08131e"/>
    </linearGradient>
    <linearGradient id="console-glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${scene.accent}" stop-opacity=".18"/>
      <stop offset="1" stop-color="${scene.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="400" height="100" fill="url(#console-bg)"/>
  <rect width="400" height="100" fill="url(#console-glow)"/>
  <rect width="400" height="3" fill="${scene.accent}"/>
  <text x="12" y="17" fill="${scene.accent}" font-family="-apple-system,Arial" font-size="9" font-weight="800" letter-spacing=".8">${escapeXml(scene.label.toUpperCase())}</text>
  ${scene.live ? `<circle cx="${12 + Math.min(170, scene.label.length * 6.2)}" cy="14" r="3" fill="#4ade80"/>` : ""}
  <text x="388" y="17" text-anchor="end" fill="#718399" font-family="-apple-system,Arial" font-size="8" font-weight="700">${scene.position + 1}/${scene.count}  ·  TURN TO CYCLE</text>
  ${titleText}
  <text x="12" y="${multiline ? 74 : 68}" fill="#b9c7d7" font-family="-apple-system,Arial" font-size="${multiline ? 10 : 11}" font-weight="600">${escapeXml(truncate(scene.detail, 64))}</text>
  <text x="12" y="86" fill="#718399" font-family="-apple-system,Arial" font-size="9" font-weight="650">${escapeXml(truncate(scene.support, 76))}</text>
  <rect x="12" y="94" width="376" height="3" rx="1.5" fill="#223042"/>
  <rect x="12" y="94" width="${3.76 * progress}" height="3" rx="1.5" fill="${scene.accent}"/>
  </svg>`;
}

function usageScenes(snapshot: DashboardSnapshot): ConsoleScene[] {
  const lifetime = snapshot.usage?.summary.lifetimeTokens ?? snapshot.localTokens;
  const peak = snapshot.usage?.summary.peakDailyTokens ?? 0;
  const streak = snapshot.usage?.summary.currentStreakDays ?? 0;
  return USAGE_RANGES.map((days, position) => {
    const value = days === 0 ? lifetime : usageForRange(snapshot, days) ?? lifetime;
    const label = days === 0 ? "LIFETIME" : days === 1 ? "TODAY" : `${days} DAYS`;
    return {
      label: `TOKEN USAGE · ${label}`,
      title: `${formatTokens(value)} tokens`,
      detail: `Peak day ${formatTokens(peak)} · current streak ${streak} day${streak === 1 ? "" : "s"}`,
      support: `${snapshot.source} data · press either dial to refresh`,
      accent: "#27c4f4",
      progress: days === 0 ? 100 : Math.min(100, value / Math.max(1, peak) * 100),
      position,
      count: USAGE_RANGES.length
    };
  });
}

function statusScenes(snapshot: DashboardSnapshot, nowMs = Date.now()): ConsoleScene[] {
  const scenes: Omit<ConsoleScene, "position" | "count">[] = [];
  if (snapshot.goals.length) {
    for (const goal of snapshot.goals) scenes.push(goalScene(goal));
  } else {
    scenes.push({
      label: "GOALS",
      title: "Nothing active",
      detail: "No running, paused, or blocked goal",
      support: "Create goals in Codex · turn for limits and dashboard",
      accent: "#8b74ff",
      progress: 10
    });
  }

  const limits = snapshot.rateLimits?.rateLimits;
  const windows: Array<{ label: string; window: RateLimitWindow | null | undefined }> = [
    { label: "PRIMARY", window: limits?.primary },
    { label: "SECONDARY", window: limits?.secondary }
  ];
  for (const entry of windows) {
    if (!entry.window) continue;
    const remaining = Math.max(0, 100 - entry.window.usedPercent);
    scenes.push({
      label: `RATE LIMIT · ${entry.label}`,
      title: `${remaining}% remaining`,
      detail: resetLabel(entry.window.resetsAt, nowMs),
      support: `${entry.window.usedPercent}% used · press either dial to refresh`,
      accent: remaining < 20 ? "#ef5350" : "#f5b942",
      progress: remaining
    });
  }

  scenes.push({
    label: "DASHBOARD HEALTH",
    title: `${snapshot.activeProcesses} live · ${snapshot.threads.length} tasks`,
    detail: `Updated ${relativeTime(snapshot.refreshedAt, nowMs)} ago · ${snapshot.source} source`,
    support: "Press either dial to refresh · long-touch opens Codex",
    accent: snapshot.dataError ? "#ef5350" : "#32d49a",
    progress: snapshot.dataError ? 20 : 100,
    live: snapshot.activeProcesses > 0
  });

  return scenes.map((scene, position) => ({ ...scene, position, count: scenes.length }));
}

function goalScene(goal: CodexGoal): Omit<ConsoleScene, "position" | "count"> {
  const progress = goal.tokenBudget
    ? goal.tokensUsed / Math.max(1, goal.tokenBudget) * 100
    : goal.status === "active" ? 55 : 25;
  return {
    label: `GOAL · ${goal.status}`,
    title: goal.objective,
    detail: `${formatTokens(goal.tokensUsed)} tokens · ${formatDuration(goal.timeUsedSeconds)}`,
    support: "Use the goal key to open · turn for limits and dashboard",
    accent: "#8b74ff",
    progress,
    live: goal.status === "active"
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s elapsed`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m elapsed`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m elapsed`;
}

function resetLabel(timestampSeconds: number | null | undefined, nowMs: number): string {
  if (!timestampSeconds) return "Reset time unavailable";
  const minutes = Math.max(0, Math.ceil((timestampSeconds * 1000 - nowMs) / 60_000));
  if (minutes < 60) return `Resets in ${minutes} minutes`;
  return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function normalize(index: number, count: number): number {
  return ((Math.trunc(index) % count) + count) % count;
}

function wrapTitle(value: string, max: number): string[] {
  const words = value.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > max) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 2) return lines;
  return [lines[0]!, truncate(lines.slice(1).join(" "), max)];
}
