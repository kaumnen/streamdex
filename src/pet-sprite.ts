import { existsSync, readFileSync } from "node:fs";
import type { PetMood } from "./pet.js";

export type PetAnimationState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type PetPose = {
  state: PetAnimationState;
  frame: number;
  x: number;
  y: number;
};

const FRAME_DURATIONS: Record<PetAnimationState, number[]> = {
  idle: [280, 110, 110, 140, 140, 320],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280],
  jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220],
  review: [150, 150, 150, 150, 150, 280]
};

const frameCache = new Map<string, string>();

export function petPose(mood: PetMood, nowMs: number): PetPose {
  if (mood === "coding") return codingPose(nowMs);
  if (mood === "ready") return readyPose(nowMs);
  if (mood === "sleeping") return sleepingPose(nowMs);
  if (mood === "worried") {
    const elapsed = modulo(nowMs, 6_000);
    return pose("waiting", elapsed, 157 + Math.sin(elapsed / 550) * 5, 12);
  }
  const elapsed = modulo(nowMs, 5_000);
  return pose("idle", elapsed, 157, 12 + Math.sin(elapsed / 700) * 2);
}

export function petSpriteDataUri(state: PetAnimationState, frame: number): string {
  const count = FRAME_DURATIONS[state].length;
  const normalized = modulo(frame, count);
  const key = `${state}-${normalized}`;
  const cached = frameCache.get(key);
  if (cached) return cached;

  const relative = `${key}.webp`;
  const candidates = [
    new URL(`../imgs/codex-pet/${relative}`, import.meta.url),
    new URL(`../com.kaumnen.streamdex.sdPlugin/imgs/codex-pet/${relative}`, import.meta.url)
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error(`Missing Codex pet frame: ${relative}`);
  const value = `data:image/webp;base64,${readFileSync(source).toString("base64")}`;
  frameCache.set(key, value);
  return value;
}

export function animationFrame(state: PetAnimationState, elapsedMs: number): number {
  const durations = FRAME_DURATIONS[state];
  const loopMs = durations.reduce((sum, duration) => sum + duration, 0);
  let remaining = modulo(elapsedMs, loopMs);
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index]!;
    if (remaining < duration) return index;
    remaining -= duration;
  }
  return 0;
}

function codingPose(nowMs: number): PetPose {
  const elapsed = modulo(nowMs, 14_000);
  if (elapsed < 4_000) return pose("running", elapsed, 42 + Math.sin(elapsed / 500) * 7, 12);
  if (elapsed < 5_800) return jumpingPose(elapsed - 4_000, 1_800, 76, 252);
  if (elapsed < 9_800) return pose("running", elapsed - 5_800, 270 + Math.sin(elapsed / 500) * 7, 12);
  if (elapsed < 11_600) return jumpingPose(elapsed - 9_800, 1_800, 252, 76);
  return pose("waving", elapsed - 11_600, 42, 12);
}

function readyPose(nowMs: number): PetPose {
  const elapsed = modulo(nowMs, 14_000);
  const left = 8;
  const right = 306;
  if (elapsed < 4_800) return pose("running-right", elapsed, lerp(left, right, elapsed / 4_800), 12);
  if (elapsed < 6_100) return pose("waving", elapsed - 4_800, right, 12);
  if (elapsed < 10_900) return pose("running-left", elapsed - 6_100, lerp(right, left, (elapsed - 6_100) / 4_800), 12);
  if (elapsed < 12_200) return pose("waving", elapsed - 10_900, left, 12);
  return pose("idle", elapsed - 12_200, left, 12);
}

function sleepingPose(nowMs: number): PetPose {
  const elapsed = modulo(nowMs, 28_000);
  if (elapsed < 10_000) return pose("idle", elapsed, 44, 13 + Math.sin(elapsed / 900) * 2);
  if (elapsed < 12_000) return jumpingPose(elapsed - 10_000, 2_000, 76, 252);
  if (elapsed < 24_000) return pose("idle", elapsed - 12_000, 270, 13 + Math.sin(elapsed / 900) * 2);
  if (elapsed < 26_000) return jumpingPose(elapsed - 24_000, 2_000, 252, 76);
  return pose("waving", elapsed - 26_000, 44, 12);
}

function jumpingPose(elapsed: number, duration: number, startX: number, endX: number): PetPose {
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  const eased = progress * progress * (3 - 2 * progress);
  return pose("jumping", elapsed, lerp(startX, endX, eased), 12 - Math.sin(Math.PI * progress) * 10);
}

function pose(state: PetAnimationState, elapsed: number, x: number, y: number): PetPose {
  return { state, frame: animationFrame(state, elapsed), x, y };
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function modulo(value: number, max: number): number {
  return ((Math.floor(value) % max) + max) % max;
}
