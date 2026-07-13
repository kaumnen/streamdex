import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CodexAppServerClient } from "./app-server.js";
import type { CodexGoal, CodexThread, DashboardSnapshot, RateLimits, UsageSummary } from "./model.js";

const execFileAsync = promisify(execFile);
const THREADS_SQL = `
SELECT id, title, tokens_used AS tokensUsed,
       COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs,
       rollout_path AS rolloutPath
FROM threads
WHERE archived = 0 AND preview <> '' AND thread_source = 'user'
ORDER BY recency_at_ms DESC, id DESC
LIMIT 32;`;
const GOALS_SQL = `
SELECT thread_id AS threadId, objective, status, tokens_used AS tokensUsed,
       token_budget AS tokenBudget, time_used_seconds AS timeUsedSeconds,
       updated_at_ms AS updatedAtMs
FROM thread_goals
WHERE status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited')
ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at_ms DESC;`;

export class CodexDataService extends EventEmitter {
  private readonly codexHome: string;
  private readonly appServer = new CodexAppServerClient();
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = 10_000;
  private refreshing: Promise<DashboardSnapshot> | null = null;
  private lastAccountRefresh = 0;
  private usage: UsageSummary | null = null;
  private rateLimits: RateLimits | null = null;
  private snapshot: DashboardSnapshot = emptySnapshot();

  constructor(codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex")) {
    super();
    this.codexHome = codexHome;
  }

  get current(): DashboardSnapshot {
    return this.snapshot;
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.appServer.stop();
  }

  setIntervalSeconds(seconds: number): void {
    this.intervalMs = Math.min(60, Math.max(5, seconds)) * 1000;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    }
  }

  async refresh(forceAccount = false): Promise<DashboardSnapshot> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(forceAccount).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(forceAccount: boolean): Promise<DashboardSnapshot> {
    const [threadsResult, goalsResult, activeResult] = await Promise.allSettled([
      querySqlite<CodexThreadRow>(join(this.codexHome, "state_5.sqlite"), THREADS_SQL),
      querySqlite<CodexGoal>(join(this.codexHome, "goals_1.sqlite"), GOALS_SQL),
      readActiveThreads(join(this.codexHome, "process_manager", "chat_processes.json"))
    ]);

    const threadRows = threadsResult.status === "fulfilled" ? threadsResult.value : [];
    let writerIds = new Set(threadRows.map((thread) => thread.id));
    try {
      writerIds = await readLiveWriterThreads(threadRows);
    } catch {
      // Fail safe: focusing Codex is preferable to resuming a thread with an unknown writer state.
    }
    const activeIds = activeResult.status === "fulfilled" ? activeResult.value : new Set<string>();
    for (const id of writerIds) activeIds.add(id);
    const threads = threadsResult.status === "fulfilled"
      ? threadsResult.value.map(({ rolloutPath: _rolloutPath, ...thread }) => ({
          ...thread,
          active: activeIds.has(thread.id)
        }))
      : [];
    const goals = goalsResult.status === "fulfilled" ? goalsResult.value : [];

    let source: DashboardSnapshot["source"] = "local";
    if (forceAccount || Date.now() - this.lastAccountRefresh > 60_000) {
      try {
        const [usage, rateLimits] = await Promise.all([
          this.appServer.call<UsageSummary>("account/usage/read"),
          this.appServer.call<RateLimits>("account/rateLimits/read")
        ]);
        this.usage = usage;
        this.rateLimits = rateLimits;
        this.lastAccountRefresh = Date.now();
        source = "app-server";
      } catch {}
    } else if (this.usage || this.rateLimits) {
      source = "app-server";
    }

    const dataError = threadsResult.status === "rejected" || goalsResult.status === "rejected";

    this.snapshot = {
      threads,
      goals,
      usage: this.usage,
      rateLimits: this.rateLimits,
      localTokens: threads.reduce((sum, thread) => sum + Number(thread.tokensUsed || 0), 0),
      activeProcesses: activeIds.size,
      refreshedAt: Date.now(),
      source,
      dataError
    };
    this.emit("update", this.snapshot);
    return this.snapshot;
  }
}

type CodexThreadRow = Omit<CodexThread, "active"> & { rolloutPath: string };

async function querySqlite<T>(database: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", ["-readonly", "-json", database, sql], {
    maxBuffer: 2 * 1024 * 1024
  });
  if (!stdout.trim()) return [];
  return JSON.parse(stdout) as T[];
}

async function readActiveThreads(path: string): Promise<Set<string>> {
  type ProcessEntry = { conversationId?: string; updatedAtMs?: number };
  const entries = JSON.parse(await readFile(path, "utf8")) as ProcessEntry[];
  const cutoff = Date.now() - 45_000;
  return new Set(
    entries
      .filter((entry) => Number(entry.updatedAtMs ?? 0) >= cutoff)
      .map((entry) => entry.conversationId)
      .filter((id): id is string => Boolean(id))
  );
}

async function readLiveWriterThreads(threads: CodexThreadRow[]): Promise<Set<string>> {
  if (!threads.length) return new Set();
  const idByPath = new Map(threads.map((thread) => [thread.rolloutPath, thread.id]));
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("/usr/sbin/lsof", ["-Fn", "--", ...idByPath.keys()], {
      maxBuffer: 512 * 1024
    }));
  } catch (error) {
    const output = error && typeof error === "object" && "stdout" in error ? error.stdout : undefined;
    if (typeof output !== "string") throw error;
    stdout = output;
  }

  const ids = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("n")) continue;
    const id = idByPath.get(line.slice(1));
    if (id) ids.add(id);
  }
  return ids;
}

function emptySnapshot(): DashboardSnapshot {
  return {
    threads: [],
    goals: [],
    usage: null,
    rateLimits: null,
    localTokens: 0,
    activeProcesses: 0,
    refreshedAt: 0,
    source: "local",
    dataError: false
  };
}
