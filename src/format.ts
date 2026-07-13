import type { DashboardSnapshot, RateLimitWindow } from "./model.js";

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(Math.round(value));
}

export function relativeTime(timestampMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function usageForRange(snapshot: DashboardSnapshot, days: number): number | null {
  const buckets = snapshot.usage?.dailyUsageBuckets;
  if (!buckets?.length) return null;
  return [...buckets]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .slice(-days)
    .reduce((sum, bucket) => sum + bucket.tokens, 0);
}

export function rateWindow(snapshot: DashboardSnapshot, index: number): { label: string; window: RateLimitWindow } | null {
  const limits = snapshot.rateLimits?.rateLimits;
  if (!limits) return null;
  const candidates = [
    { label: "PRIMARY", window: limits.primary },
    { label: "SECONDARY", window: limits.secondary }
  ].filter((entry): entry is { label: string; window: RateLimitWindow } => Boolean(entry.window));
  if (!candidates.length) return null;
  return candidates[((index % candidates.length) + candidates.length) % candidates.length] ?? null;
}

export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(1, max - 1))}…`;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character]!);
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}
