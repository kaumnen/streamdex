export interface CodexThread {
  id: string;
  title: string;
  tokensUsed: number;
  updatedAtMs: number;
  active: boolean;
}

export interface CodexGoal {
  threadId: string;
  objective: string;
  status: string;
  tokensUsed: number;
  tokenBudget: number | null;
  timeUsedSeconds: number;
  updatedAtMs: number;
}

export interface UsageSummary {
  dailyUsageBuckets: Array<{ startDate: string; tokens: number }> | null;
  summary: {
    lifetimeTokens?: number | null;
    currentStreakDays?: number | null;
    longestStreakDays?: number | null;
    peakDailyTokens?: number | null;
    longestRunningTurnSec?: number | null;
  };
}

export interface RateLimitWindow {
  usedPercent: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

export interface RateLimits {
  rateLimits: {
    primary?: RateLimitWindow | null;
    secondary?: RateLimitWindow | null;
    planType?: string | null;
    credits?: { balance?: string | number | null; unlimited?: boolean } | null;
  };
}

export interface DashboardSnapshot {
  threads: CodexThread[];
  goals: CodexGoal[];
  usage: UsageSummary | null;
  rateLimits: RateLimits | null;
  localTokens: number;
  activeProcesses: number;
  refreshedAt: number;
  source: "app-server" | "local";
  dataError: boolean;
}
