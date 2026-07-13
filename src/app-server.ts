import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private initialized: Promise<void> | null = null;
  private stderr = "";

  constructor(private readonly codexBinary = findCodexBinary()) {}

  async call<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted();
    return this.request<T>(method, params);
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.initialized = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex app-server stopped"));
    }
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.start().catch((error) => {
        this.initialized = null;
        this.child?.kill();
        this.child = null;
        throw error;
      });
    }
    return this.initialized;
  }

  private async start(): Promise<void> {
    this.child = spawn(this.codexBinary, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    this.child.on("exit", () => this.handleExit());
    this.child.on("error", (error) => this.handleExit(error));

    await this.request("initialize", {
      clientInfo: {
        name: "streamdex",
        title: "Streamdex",
        version: "0.1.0"
      },
      capabilities: null
    });
    this.notify("initialized");
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is unavailable"));
    }

    const id = this.nextId++;
    const payload = JSON.stringify(params === undefined ? { id, method } : { id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server timed out: ${method}`));
      }, 8_000);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });
      this.child!.stdin.write(`${payload}\n`);
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is unavailable");
    const payload = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Codex app-server error"));
    } else {
      pending.resolve(message.result);
    }
  }

  private handleExit(error?: Error): void {
    const detail = this.stderr.trim();
    const reason = error ?? new Error(detail ? `Codex app-server exited: ${detail}` : "Codex app-server exited");
    this.stderr = "";
    this.child = null;
    this.initialized = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

export function findCodexBinary(): string {
  const candidates = [
    process.env.CODEX_BIN,
    join(homedir(), ".local", "bin", "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex"
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? "codex";
}
