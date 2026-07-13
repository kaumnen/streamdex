import {
  default as streamDeck,
  action,
  type DidReceiveSettingsEvent,
  type DialRotateEvent,
  type DialUpEvent,
  type KeyUpEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import { dashboard } from "./dashboard.js";
import {
  consolePanelSvg,
  consoleScene,
  consoleSceneCount,
  type ConsoleGroup
} from "./console.js";
import { formatTokens, rateWindow, relativeTime, truncate, usageForRange } from "./format.js";
import type { DashboardSnapshot } from "./model.js";
import { petDetailSvg, petPanelSvg, petView } from "./pet.js";
import { withPetCameo } from "./pet-cameo.js";
import { petRoamer } from "./pet-roamer.js";
import { pairedKeySvg, renderCard, svgDataUri } from "./render.js";

type IndexSettings = { index?: number; slot?: number; panel?: number; group?: ConsoleGroup };

abstract class DashboardAction extends SingletonAction<IndexSettings> {
  protected readonly allowPetCameo: boolean = true;
  protected readonly allowPetCameoOnDials: boolean = false;
  private readonly visibleSettings = new Map<string, IndexSettings>();

  override async onWillAppear(ev: WillAppearEvent<IndexSettings>): Promise<void> {
    streamDeck.logger.info(`Action visible: ${ev.action.isDial() ? "dial" : "key"} ${ev.action.id}`);
    this.visibleSettings.set(ev.action.id, ev.payload.settings);
    const allowPetCameo = this.allowPetCameo && (!ev.action.isDial() || this.allowPetCameoOnDials);
    dashboard.register(ev.action, async (snapshot) => {
      const settings = this.visibleSettings.get(ev.action.id) ?? ev.payload.settings;
      await this.render(ev.action, settings, snapshot);
    }, allowPetCameo ? ev.action.isDial() ? "screen" : "tile" : null);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<IndexSettings>): void {
    if (this.visibleSettings.has(ev.action.id)) {
      this.visibleSettings.set(ev.action.id, ev.payload.settings);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent<IndexSettings>): void {
    this.visibleSettings.delete(ev.action.id);
    dashboard.unregister(ev.action);
  }

  protected abstract render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void>;

  protected async changeIndex(ev: DialRotateEvent<IndexSettings>, max: number): Promise<number> {
    const current = Number(ev.payload.settings.index ?? ev.payload.settings.slot ?? 0);
    const index = ((current + Math.sign(ev.payload.ticks) * Math.max(1, Math.abs(ev.payload.ticks))) % max + max) % max;
    await this.setSettings(ev.action, { ...ev.payload.settings, index });
    return index;
  }

  protected async setSettings(action: WillAppearEvent["action"], settings: IndexSettings): Promise<void> {
    this.visibleSettings.set(action.id, settings);
    await action.setSettings(settings);
  }
}

@action({ UUID: "com.kaumnen.streamdex.pet" })
export class PetAction extends DashboardAction {
  protected override readonly allowPetCameo: boolean = false;
  private selectedIndex = 0;
  private initialized = false;
  private readonly visible = new Map<string, { action: WillAppearEvent["action"]; settings: IndexSettings }>();
  private animationTimer: NodeJS.Timeout | null = null;
  private renderingAnimation = false;

  override async onWillAppear(ev: WillAppearEvent<IndexSettings>): Promise<void> {
    this.visible.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
    this.startAnimation();
    await super.onWillAppear(ev);
  }

  override onWillDisappear(ev: WillDisappearEvent<IndexSettings>): void {
    this.visible.delete(ev.action.id);
    if (!this.visible.size && this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    super.onWillDisappear(ev);
  }

  override async onKeyUp(_ev: KeyUpEvent<IndexSettings>): Promise<void> {
    dashboard.openCodex();
  }

  override async onDialUp(ev: DialUpEvent<IndexSettings>): Promise<void> {
    this.open(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const count = Math.max(1, dashboard.data.current.threads.length);
    const delta = Math.sign(ev.payload.ticks) * Math.max(1, Math.abs(ev.payload.ticks));
    this.selectedIndex = ((this.selectedIndex + delta) % count + count) % count;
    const settings = { ...ev.payload.settings, index: this.selectedIndex };
    await this.setSettings(ev.action, settings);
    const visible = this.visible.get(ev.action.id);
    if (visible) visible.settings = settings;
    await this.renderVisible();
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) await dashboard.refresh(true);
    else this.open(ev.action);
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    if (!this.initialized && Number(settings.panel ?? 0) === 0) {
      this.selectedIndex = Number(settings.index ?? 0);
      this.initialized = true;
    }
    const view = petView(snapshot, this.selectedIndex);
    const nowMs = Date.now();
    if (action.isDial()) {
      const travel = petRoamer.homeTravelFor(nowMs);
      const svg = Number(settings.panel ?? 0) === 0
        ? petPanelSvg(view, nowMs, travel)
        : petDetailSvg(view, nowMs, travel);
      await action.setFeedback({ canvas: { value: svgDataUri(svg) } });
      return;
    }
    await renderCard(action, {
      eyebrow: "CODEX STATUS",
      title: snapshot.activeProcesses ? `${snapshot.activeProcesses} running` : "Ready",
      meta: `${snapshot.threads.length} recent · ${snapshot.source}`,
      accent: view.accent,
      progress: snapshot.activeProcesses ? 100 : 35,
      live: snapshot.activeProcesses > 0
    });
  }

  private startAnimation(): void {
    if (this.animationTimer) return;
    this.animationTimer = setInterval(() => void this.renderVisible(), 160);
  }

  private async renderVisible(): Promise<void> {
    if (this.renderingAnimation) return;
    this.renderingAnimation = true;
    try {
      const snapshot = dashboard.data.current;
      await Promise.allSettled(
        [...this.visible.values()].map(({ action, settings }) => this.render(action, settings, snapshot))
      );
    } finally {
      this.renderingAnimation = false;
    }
  }

  private open(action: WillAppearEvent["action"]): void {
    const thread = petView(dashboard.data.current, this.selectedIndex).thread;
    if (thread) {
      if (!dashboard.openThread(thread.id)) void action.showAlert();
      return;
    }
    dashboard.openNewThread();
  }
}

@action({ UUID: "com.kaumnen.streamdex.console" })
export class ConsoleAction extends DashboardAction {
  protected override readonly allowPetCameoOnDials: boolean = true;
  private readonly selected: Record<ConsoleGroup, number> = { usage: 0, status: 0 };
  private readonly initialized = new Set<ConsoleGroup>();
  private readonly visible = new Map<string, { action: WillAppearEvent["action"]; settings: IndexSettings }>();

  override async onWillAppear(ev: WillAppearEvent<IndexSettings>): Promise<void> {
    const group = consoleGroup(ev.payload.settings);
    if (!this.initialized.has(group)) {
      this.selected[group] = Number(ev.payload.settings.index ?? 0);
      this.initialized.add(group);
    }
    this.visible.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
    await super.onWillAppear(ev);
  }

  override onWillDisappear(ev: WillDisappearEvent<IndexSettings>): void {
    this.visible.delete(ev.action.id);
    super.onWillDisappear(ev);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const group = consoleGroup(ev.payload.settings);
    const count = consoleSceneCount(group, dashboard.data.current);
    const delta = Math.sign(ev.payload.ticks) * Math.max(1, Math.abs(ev.payload.ticks));
    this.selected[group] = ((this.selected[group] + delta) % count + count) % count;
    await this.renderGroup(group);
  }

  override async onDialUp(ev: DialUpEvent<IndexSettings>): Promise<void> {
    await dashboard.refresh(true);
    await this.render(ev.action, ev.payload.settings, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) {
      dashboard.openCodex();
      return;
    }
    const group = consoleGroup(ev.payload.settings);
    const count = consoleSceneCount(group, dashboard.data.current);
    this.selected[group] = (this.selected[group] + 1) % count;
    await this.renderGroup(group);
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    if (!action.isDial()) return;
    const group = consoleGroup(settings);
    const scene = consoleScene(group, this.selected[group], snapshot);
    const panel = Number(settings.panel ?? 0);
    const svg = withPetCameo(consolePanelSvg(scene, panel), action.id, 0, 400, 100);
    await action.setFeedback({
      canvas: { value: svgDataUri(svg) }
    });
  }

  private async renderGroup(group: ConsoleGroup): Promise<void> {
    const entries = [...this.visible.values()].filter(({ settings }) => consoleGroup(settings) === group);
    await Promise.allSettled(entries.map(async (entry) => {
      entry.settings = { ...entry.settings, index: this.selected[group] };
      await this.setSettings(entry.action, entry.settings);
      await this.render(entry.action, entry.settings, dashboard.data.current);
    }));
  }
}

@action({ UUID: "com.kaumnen.streamdex.recent-task" })
export class RecentTaskAction extends DashboardAction {
  override async onKeyUp(ev: KeyUpEvent<IndexSettings>): Promise<void> {
    this.open(ev.payload.settings.slot ?? 0, ev.action);
  }

  override async onDialUp(ev: DialUpEvent<IndexSettings>): Promise<void> {
    this.open(ev.payload.settings.index ?? 0, ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const count = Math.max(1, dashboard.data.current.threads.length);
    const index = await this.changeIndex(ev, count);
    await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) dashboard.openNewThread();
    else this.open(ev.payload.settings.index ?? 0, ev.action);
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const index = action.isDial() ? Number(settings.index ?? 0) : Number(settings.slot ?? 0);
    const thread = snapshot.threads[index];
    if (!action.isDial() && settings.panel !== undefined) {
      const active = Boolean(thread?.active);
      await action.setImage(svgDataUri(pairedKeySvg({
        accent: "#10a37f",
        live: active,
        progress: active ? 100 : thread ? 25 : 5,
        left: {
          eyebrow: `TASK ${index + 1}`,
          value: active ? "Running now" : thread ? "Recent" : "Empty",
          meta: thread ? `${formatTokens(thread.tokensUsed)} · ${relativeTime(thread.updatedAtMs)}` : "No recent task"
        },
        right: {
          eyebrow: active ? "CURRENT TASK" : "TASK TITLE",
          value: thread?.title ?? "Open Codex",
          meta: thread ? "press either to open" : "create a new task"
        }
      }, Number(settings.panel), action.id)));
      await action.setTitle("");
      return;
    }
    if (!thread) {
      await renderCard(action, {
        eyebrow: `RECENT #${index + 1}`,
        title: "No task yet",
        meta: "tap: open Codex",
        accent: "#10a37f",
        dialLabel: `TASK ${index + 1}`,
        dialValue: "No task",
        dialMeta: "turn: select · tap: open"
      });
      return;
    }
    await renderCard(action, {
      eyebrow: thread.active ? "RUNNING NOW" : `RECENT #${index + 1}`,
      title: truncate(thread.title, 28),
      meta: `${formatTokens(thread.tokensUsed)} tokens · ${relativeTime(thread.updatedAtMs)}`,
      accent: "#10a37f",
      progress: thread.active ? 100 : 20,
      live: thread.active,
      dialLabel: thread.active ? `TASK ${index + 1} · RUNNING` : `TASK ${index + 1} · ${relativeTime(thread.updatedAtMs)}`,
      dialValue: truncate(thread.title, 23),
      dialMeta: `${formatTokens(thread.tokensUsed)} tokens · press to open`
    });
  }

  private open(index: number, action: WillAppearEvent["action"]): void {
    const thread = dashboard.data.current.threads[index];
    if (!thread || !dashboard.openThread(thread.id)) void action.showAlert();
  }
}

@action({ UUID: "com.kaumnen.streamdex.goal" })
export class GoalAction extends DashboardAction {
  override async onKeyUp(ev: KeyUpEvent<IndexSettings>): Promise<void> {
    this.open(ev.payload.settings.slot ?? 0, ev.action);
  }

  override async onDialUp(ev: DialUpEvent<IndexSettings>): Promise<void> {
    this.open(ev.payload.settings.index ?? 0, ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const index = await this.changeIndex(ev, Math.max(1, dashboard.data.current.goals.length));
    await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) await dashboard.refresh();
    else this.open(ev.payload.settings.index ?? 0, ev.action);
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const index = action.isDial() ? Number(settings.index ?? 0) : Number(settings.slot ?? 0);
    const goal = snapshot.goals[index];
    if (!goal) {
      await renderCard(action, {
        eyebrow: "ACTIVE GOAL",
        title: "No active goal",
        meta: "nothing blocked",
        accent: "#7c5cfc",
        dialLabel: "GOAL",
        dialValue: "None active",
        dialMeta: "turn: select · press: open"
      });
      return;
    }
    const progress = goal.tokenBudget ? goal.tokensUsed / goal.tokenBudget * 100 : goal.status === "active" ? 55 : 25;
    await renderCard(action, {
      eyebrow: `GOAL · ${goal.status}`,
      title: truncate(goal.objective, 28),
      meta: `${formatTokens(goal.tokensUsed)} · ${formatDuration(goal.timeUsedSeconds)}`,
      accent: "#7c5cfc",
      progress,
      live: goal.status === "active",
      dialLabel: `GOAL · ${goal.status.toUpperCase()}`,
      dialValue: truncate(goal.objective, 23),
      dialMeta: `${formatTokens(goal.tokensUsed)} tokens · press to open`
    });
  }

  private open(index: number, action: WillAppearEvent["action"]): void {
    const goal = dashboard.data.current.goals[index];
    if (!goal || !dashboard.openThread(goal.threadId)) void action.showAlert();
  }
}

@action({ UUID: "com.kaumnen.streamdex.usage" })
export class UsageAction extends DashboardAction {
  private readonly ranges = [1, 7, 30, 0];

  override async onKeyUp(): Promise<void> {
    await dashboard.refresh(true);
  }

  override async onDialUp(): Promise<void> {
    await dashboard.refresh(true);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const index = await this.changeIndex(ev, this.ranges.length);
    await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) dashboard.openCodex();
    else {
      const index = ((ev.payload.settings.index ?? 0) + 1) % this.ranges.length;
      await this.setSettings(ev.action, { ...ev.payload.settings, index });
      await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
    }
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const index = Number(settings.index ?? 0);
    const days = this.ranges[index] ?? 1;
    const lifetime = days === 0;
    const usage = lifetime ? snapshot.usage?.summary.lifetimeTokens ?? null : usageForRange(snapshot, days);
    const value = usage ?? snapshot.usage?.summary.lifetimeTokens ?? snapshot.localTokens;
    const label = lifetime
      ? "LIFETIME"
      : usage === null
        ? (snapshot.usage ? "LIFETIME" : "LOCAL TOTAL")
        : days === 1 ? "TODAY" : `${days} DAYS`;
    const peak = snapshot.usage?.summary.peakDailyTokens ?? value ?? 1;
    if (!action.isDial() && settings.panel !== undefined) {
      await action.setImage(svgDataUri(pairedKeySvg({
        accent: "#00a9e0",
        progress: lifetime ? 100 : Math.min(100, (value ?? 0) / Math.max(1, peak) * 100),
        left: {
          eyebrow: "USAGE RANGE",
          value: label,
          meta: `${snapshot.source} data`
        },
        right: {
          eyebrow: "TOKEN TOTAL",
          value: formatTokens(value ?? 0),
          meta: "tokens · press refresh"
        }
      }, Number(settings.panel), action.id)));
      await action.setTitle("");
      return;
    }
    await renderCard(action, {
      eyebrow: `USAGE · ${label}`,
      title: formatTokens(value ?? 0),
      meta: `tokens · ${snapshot.source}`,
      accent: "#00a9e0",
      progress: lifetime ? 100 : Math.min(100, (value ?? 0) / Math.max(1, peak) * 100),
      dialLabel: `USAGE · ${label}`,
      dialValue: `${formatTokens(value ?? 0)} tokens`,
      dialMeta: "turn: range · press: refresh"
    });
  }
}

@action({ UUID: "com.kaumnen.streamdex.rate-limit" })
export class RateLimitAction extends DashboardAction {
  override async onKeyUp(): Promise<void> {
    await dashboard.refresh(true);
  }

  override async onDialUp(): Promise<void> {
    await dashboard.refresh(true);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const index = await this.changeIndex(ev, 2);
    await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) dashboard.openCodex();
    else {
      const index = ((ev.payload.settings.index ?? 0) + 1) % 2;
      await this.setSettings(ev.action, { ...ev.payload.settings, index });
      await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
    }
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const entry = rateWindow(snapshot, Number(settings.index ?? 0));
    if (!entry) {
      await renderCard(action, { eyebrow: "RATE LIMIT", title: "Unavailable", meta: "Tap to retry", accent: "#f5a623" });
      return;
    }
    const remaining = Math.max(0, 100 - entry.window.usedPercent);
    await renderCard(action, {
      eyebrow: `LIMIT · ${entry.label}`,
      title: `${remaining}% left`,
      meta: resetLabel(entry.window.resetsAt),
      accent: remaining < 20 ? "#ef4444" : "#f5a623",
      progress: remaining,
      dialLabel: `LIMIT · ${entry.label}`,
      dialValue: `${remaining}% remaining`,
      dialMeta: `${resetLabel(entry.window.resetsAt)} · press: refresh`
    });
  }
}

@action({ UUID: "com.kaumnen.streamdex.control" })
export class ControlAction extends DashboardAction {
  private readonly intervals = [5, 10, 15, 30, 60];

  override async onKeyUp(): Promise<void> {
    dashboard.openNewThread();
  }

  override async onDialUp(): Promise<void> {
    await dashboard.refresh(true);
  }

  override async onDialRotate(ev: DialRotateEvent<IndexSettings>): Promise<void> {
    const index = await this.changeIndex(ev, this.intervals.length);
    dashboard.data.setIntervalSeconds(this.intervals[index] ?? 10);
    await this.render(ev.action, { ...ev.payload.settings, index }, dashboard.data.current);
  }

  override async onTouchTap(ev: TouchTapEvent<IndexSettings>): Promise<void> {
    if (ev.payload.hold) dashboard.openSettings();
    else dashboard.openNewThread();
  }

  protected override async render(action: WillAppearEvent["action"], settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const interval = this.intervals[Number(settings.index ?? 1)] ?? 10;
    await renderCard(action, {
      eyebrow: action.isDial() ? "REFRESH RATE" : "NEW TASK",
      title: action.isDial() ? `Every ${interval}s` : "Open Codex",
      meta: action.isDial() ? "press: refresh now" : "tap to create",
      accent: "#e0528d",
      progress: snapshot.activeProcesses ? 100 : 30,
      live: snapshot.activeProcesses > 0,
      dialLabel: "DASHBOARD REFRESH",
      dialValue: `Every ${interval} seconds`,
      dialMeta: "turn: interval · tap: new task"
    });
  }
}

@action({ UUID: "com.kaumnen.streamdex.status" })
export class StatusAction extends DashboardAction {
  override async onKeyUp(): Promise<void> {
    dashboard.openCodex();
  }

  protected override async render(action: WillAppearEvent["action"], _settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    const running = snapshot.activeProcesses;
    await renderCard(action, {
      eyebrow: "CODEX STATUS",
      title: running ? `${running} running` : "Ready",
      meta: `${snapshot.threads.length} recent · ${snapshot.source}`,
      accent: running ? "#10a37f" : "#60a5fa",
      progress: running ? 100 : 35,
      live: running > 0
    });
  }
}

@action({ UUID: "com.kaumnen.streamdex.refresh" })
export class RefreshAction extends DashboardAction {
  override async onKeyUp(ev: KeyUpEvent<IndexSettings>): Promise<void> {
    await dashboard.refresh(true);
    await ev.action.showOk();
  }

  protected override async render(action: WillAppearEvent["action"], _settings: IndexSettings, snapshot: DashboardSnapshot): Promise<void> {
    await renderCard(action, {
      eyebrow: "REFRESH DATA",
      title: "Update now",
      meta: `last ${relativeTime(snapshot.refreshedAt)}`,
      accent: "#60a5fa",
      progress: 100
    });
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

function resetLabel(timestampSeconds: number | null | undefined): string {
  if (!timestampSeconds) return "reset unknown";
  const minutes = Math.max(0, Math.ceil((timestampSeconds * 1000 - Date.now()) / 60_000));
  if (minutes < 60) return `resets in ${minutes}m`;
  return `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function consoleGroup(settings: IndexSettings): ConsoleGroup {
  return settings.group === "usage" ? "usage" : "status";
}
