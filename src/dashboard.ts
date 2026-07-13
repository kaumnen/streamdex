import { spawn } from "node:child_process";
import streamDeck, { type ActionContext, type DialAction, type KeyAction } from "@elgato/streamdeck";
import { CodexDataService } from "./data-service.js";
import type { DashboardSnapshot } from "./model.js";
import { petRoamer, type PetDestination, type PetRoamer } from "./pet-roamer.js";

type Renderer = (snapshot: DashboardSnapshot) => Promise<void>;

const PET_ACTION_ID = "com.kaumnen.streamdex.pet";

type VisibleAction = {
  id: string;
  manifestId: string;
  device: { id: string };
};

type RoamingPetState = Pick<PetRoamer, "advance" | "setEligibleActionIds">;

export class RoamingPetLoop {
  private readonly pendingActionIds = new Set<string>();
  private rendering = false;

  constructor(
    private readonly roamer: RoamingPetState,
    private readonly eligibleActionIds: () => Iterable<string>,
    private readonly render: (actionId: string) => Promise<void>,
    private readonly onRenderError: (reason: unknown) => void = () => undefined
  ) {}

  async tick(nowMs = Date.now()): Promise<void> {
    this.roamer.setEligibleActionIds(this.eligibleActionIds(), nowMs);
    for (const actionId of this.roamer.advance(nowMs)) this.pendingActionIds.add(actionId);
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      while (this.pendingActionIds.size) {
        const actionIds = [...this.pendingActionIds];
        this.pendingActionIds.clear();
        const results = await Promise.allSettled(actionIds.map((actionId) => this.render(actionId)));
        for (const result of results) {
          if (result.status === "rejected") this.onRenderError(result.reason);
        }
      }
    } finally {
      this.rendering = false;
    }
  }
}

export function visiblePetSheetActionIds(actions: Iterable<VisibleAction>): string[] {
  const visible = [...actions];
  const petDeviceIds = new Set(
    visible.filter((action) => action.manifestId === PET_ACTION_ID).map((action) => action.device.id)
  );
  return visible
    .filter((action) => petDeviceIds.has(action.device.id))
    .map((action) => action.id);
}

export class Dashboard {
  readonly data = new CodexDataService();
  private readonly renderers = new Map<string, Renderer>();
  private readonly roamingPetLoop = new RoamingPetLoop(
    petRoamer,
    () => visiblePetSheetActionIds(streamDeck.actions),
    async (actionId) => {
      const renderer = this.renderers.get(actionId);
      if (renderer) await renderer(this.data.current);
    },
    (reason) => streamDeck.logger.error(`Roaming pet render failed: ${String(reason)}`)
  );
  private roamingPetTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.data.on("update", (snapshot: DashboardSnapshot) => {
      streamDeck.logger.info(
        `Dashboard updated: ${snapshot.threads.length} tasks, ${snapshot.goals.length} goals, ` +
        `${snapshot.activeProcesses} active, source=${snapshot.source}`
      );
      void this.renderAll(snapshot);
    });
  }

  register(
    action: DialAction | KeyAction,
    renderer: Renderer,
    petDestination: PetDestination | null = null
  ): void {
    this.renderers.set(action.id, renderer);
    if (petDestination) {
      const groupId = petDestination === "screen" && action.isDial()
        ? screenPairId(action.device.id, action.coordinates.column)
        : action.id;
      petRoamer.add(action.id, petDestination, Date.now(), groupId);
      this.startRoamingPet();
    }
    this.data.start();
    void renderer(this.data.current);
  }

  unregister(action: ActionContext): void {
    this.renderers.delete(action.id);
    petRoamer.remove(action.id);
    if (!petRoamer.size && this.roamingPetTimer) {
      clearInterval(this.roamingPetTimer);
      this.roamingPetTimer = null;
    }
  }

  async refresh(forceAccount = false): Promise<void> {
    await this.data.refresh(forceAccount);
  }

  openThread(threadId: string): boolean {
    const url = codexUrlForThread(this.data.current, threadId);
    if (!url) return false;
    openCodexUrl(url);
    return true;
  }

  openNewThread(): void {
    openCodexUrl("codex://threads/new");
  }

  openCodex(): void {
    openCodexUrl("codex://");
  }

  openSettings(): void {
    openCodexUrl("codex://settings");
  }

  private async renderAll(snapshot: DashboardSnapshot): Promise<void> {
    const results = await Promise.allSettled([...this.renderers.values()].map((render) => render(snapshot)));
    for (const result of results) {
      if (result.status === "rejected") {
        streamDeck.logger.error(`Dashboard render failed: ${String(result.reason)}`);
      }
    }
  }

  private startRoamingPet(): void {
    if (this.roamingPetTimer) return;
    this.roamingPetTimer = setInterval(() => void this.renderRoamingPet(), 160);
  }

  private async renderRoamingPet(): Promise<void> {
    await this.roamingPetLoop.tick();
  }
}

export function codexUrlForThread(snapshot: DashboardSnapshot, threadId: string): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return null;
  const hasLiveWriter = snapshot.threads.some((thread) => thread.id === threadId && thread.active);
  return hasLiveWriter ? "codex://" : `codex://threads/${threadId}`;
}

export function screenPairId(deviceId: string, column: number): string {
  return `${deviceId}:dial-pair:${Math.floor(column / 2)}`;
}

function openCodexUrl(url: string): void {
  const child = spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export const dashboard = new Dashboard();
