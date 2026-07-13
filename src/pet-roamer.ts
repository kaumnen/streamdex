export type PetCameoEdge = "left" | "right" | "top" | "bottom";
export type PetDestination = "tile" | "screen";
export type PetTravelEdge = "left" | "right";
export type PetTravelPhase = "home" | "departing" | "away" | "returning";
export type PetScreenVisitMode = "stay" | "peek";

export type PetCameo = {
  destination: PetDestination;
  edge: PetCameoEdge;
  message: string;
  x: number;
  y: number;
  elapsedMs: number;
  durationMs: number;
  screenMode?: PetScreenVisitMode;
};

export type PetHomeTravel = {
  phase: PetTravelPhase;
  edge: PetTravelEdge;
  elapsedMs: number;
  durationMs: number;
  destination?: PetDestination;
};

export const PET_CAMEO_DURATION_MS = 3_200;
export const PET_SCREEN_STAY_DURATION_MS = 8_000;
export const PET_SCREEN_PEEK_DURATION_MS = 2_800;
export const PET_DEPARTURE_DURATION_MS = 1_200;
export const PET_RETURN_DURATION_MS = 1_100;
export const PET_CAMEO_INITIAL_DELAY_MS = 1_000;
export const PET_TILE_VISIT_PROBABILITY = 0.8;

const PET_CAMEO_REST_MS = 1_000;
const PET_CAMEO_MESSAGES = [
  "HELLO THERE!",
  "HOW'S IT GOING?",
  "STILL VIBING?",
  "YOU GOT THIS!",
  "NICE WORK!",
  "ALL GOOD?",
  "KEEP GOING!",
  "HI THERE!"
] as const;

type Candidate = {
  destination: PetDestination;
  groupId: string;
};

type CandidateGroup = {
  id: string;
  destination: PetDestination;
  actionIds: string[];
};

type RoamingPhase = "home" | "departing" | "visiting" | "returning";

export class PetRoamer {
  private readonly candidates = new Map<string, Candidate>();
  private eligibleActionIds: ReadonlySet<string> | null = null;
  private targetGroupId: string | null = null;
  private previousTargetGroupId: string | null = null;
  private destination: PetDestination = "tile";
  private screenMode: PetScreenVisitMode = "stay";
  private screenVisitCount = 0;
  private phase: RoamingPhase = "home";
  private edge: PetCameoEdge = "left";
  private homeEdge: PetTravelEdge = "left";
  private message: string = PET_CAMEO_MESSAGES[0];
  private x = 30;
  private y = 44;
  private phaseStartedAt = 0;
  private nextCameoAt = Number.POSITIVE_INFINITY;
  private remainingTileEdges: PetCameoEdge[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  add(
    actionId: string,
    destination: PetDestination = "tile",
    nowMs = Date.now(),
    groupId = actionId
  ): void {
    const wasEmpty = this.candidates.size === 0;
    this.candidates.set(actionId, { destination, groupId });
    if (wasEmpty && this.phase === "home") this.nextCameoAt = nowMs + PET_CAMEO_INITIAL_DELAY_MS;
  }

  remove(actionId: string, nowMs = Date.now()): void {
    const candidate = this.candidates.get(actionId);
    this.candidates.delete(actionId);
    if (candidate?.groupId === this.targetGroupId && !this.targetActionIds().length) {
      this.previousTargetGroupId = this.targetGroupId;
      this.targetGroupId = null;
      this.phase = "returning";
      this.phaseStartedAt = nowMs;
    }
    if (!this.candidates.size) this.nextCameoAt = Number.POSITIVE_INFINITY;
  }

  get size(): number {
    return this.candidates.size;
  }

  get isTraveling(): boolean {
    return this.phase !== "home";
  }

  setEligibleActionIds(actionIds: Iterable<string>, nowMs = Date.now()): void {
    this.eligibleActionIds = new Set(actionIds);
    if (
      (this.phase === "departing" || this.phase === "visiting") &&
      this.targetGroupId &&
      !this.targetActionIds().length
    ) {
      this.previousTargetGroupId = this.targetGroupId;
      this.targetGroupId = null;
      this.beginReturn(nowMs);
    }
  }

  advance(nowMs = Date.now()): string[] {
    if (this.phase === "departing") {
      if (nowMs - this.phaseStartedAt < PET_DEPARTURE_DURATION_MS) return [];
      const actionIds = this.targetActionIds();
      if (!actionIds.length) {
        this.beginReturn(nowMs);
        return [];
      }
      this.phase = "visiting";
      this.phaseStartedAt = nowMs;
      return actionIds;
    }

    if (this.phase === "visiting") {
      const actionIds = this.targetActionIds();
      if (!actionIds.length) {
        this.beginReturn(nowMs);
        return [];
      }
      if (nowMs - this.phaseStartedAt < this.visitDurationMs()) return actionIds;

      this.previousTargetGroupId = this.targetGroupId;
      this.targetGroupId = null;
      this.beginReturn(nowMs);
      return actionIds;
    }

    if (this.phase === "returning") {
      if (nowMs - this.phaseStartedAt < PET_RETURN_DURATION_MS) return [];
      this.phase = "home";
      this.phaseStartedAt = nowMs;
      this.scheduleNext(nowMs);
      return [];
    }

    if (!this.candidates.size || nowMs < this.nextCameoAt) return [];

    const groups = this.candidateGroups();
    if (!groups.length) return [];
    const tileGroups = groups.filter((group) => group.destination === "tile");
    const screenGroups = groups.filter((group) => group.destination === "screen");
    const destination = tileGroups.length && screenGroups.length
      ? this.random() < PET_TILE_VISIT_PROBABILITY ? "tile" : "screen"
      : tileGroups.length ? "tile" : "screen";
    const destinationGroups = destination === "tile" ? tileGroups : screenGroups;
    const unvisitedGroups = destinationGroups.filter((group) => group.id !== this.previousTargetGroupId);
    const pool = unvisitedGroups.length ? unvisitedGroups : destinationGroups;
    const target = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))]!;
    this.targetGroupId = target.id;
    this.destination = target.destination;
    if (target.destination === "screen") {
      this.screenVisitCount += 1;
      this.screenMode = this.screenVisitCount % 4 === 0 ? "peek" : "stay";
    }
    this.edge = target.destination === "tile" ? this.takeTileEdge() : "right";
    this.x = 16 + Math.floor(this.random() * 4) * 14;
    this.y = 34 + Math.floor(this.random() * 4) * 9;
    this.message = PET_CAMEO_MESSAGES[
      Math.min(PET_CAMEO_MESSAGES.length - 1, Math.floor(this.random() * PET_CAMEO_MESSAGES.length))
    ]!;
    this.homeEdge = target.destination === "screen"
      ? "right"
      : this.edge === "right" || ((this.edge === "top" || this.edge === "bottom") && this.x >= 37)
        ? "right"
        : "left";
    this.phase = "departing";
    this.phaseStartedAt = nowMs;
    return [];
  }

  cameoFor(actionId: string, nowMs = Date.now()): PetCameo | null {
    const candidate = this.candidates.get(actionId);
    if (this.phase !== "visiting" || candidate?.groupId !== this.targetGroupId) return null;
    const elapsedMs = nowMs - this.phaseStartedAt;
    const durationMs = this.visitDurationMs();
    if (elapsedMs < 0 || elapsedMs >= durationMs) return null;
    return {
      destination: this.destination,
      edge: this.edge,
      message: this.message,
      x: this.x,
      y: this.y,
      elapsedMs,
      durationMs,
      screenMode: this.destination === "screen" ? this.screenMode : undefined
    };
  }

  homeTravelFor(nowMs = Date.now()): PetHomeTravel {
    if (this.phase === "home") {
      return { phase: "home", edge: this.homeEdge, elapsedMs: 0, durationMs: 0, destination: this.destination };
    }
    if (this.phase === "departing") {
      return {
        phase: "departing",
        edge: this.homeEdge,
        elapsedMs: Math.max(0, nowMs - this.phaseStartedAt),
        durationMs: PET_DEPARTURE_DURATION_MS,
        destination: this.destination
      };
    }
    if (this.phase === "returning") {
      return {
        phase: "returning",
        edge: this.homeEdge,
        elapsedMs: Math.max(0, nowMs - this.phaseStartedAt),
        durationMs: PET_RETURN_DURATION_MS,
        destination: this.destination
      };
    }
    return {
      phase: "away",
      edge: this.homeEdge,
      elapsedMs: Math.max(0, nowMs - this.phaseStartedAt),
      durationMs: this.visitDurationMs(),
      destination: this.destination
    };
  }

  private candidateGroups(): CandidateGroup[] {
    const groups = new Map<string, CandidateGroup>();
    for (const [actionId, candidate] of this.candidates) {
      if (this.eligibleActionIds && !this.eligibleActionIds.has(actionId)) continue;
      const group = groups.get(candidate.groupId);
      if (group) group.actionIds.push(actionId);
      else groups.set(candidate.groupId, {
        id: candidate.groupId,
        destination: candidate.destination,
        actionIds: [actionId]
      });
    }
    return [...groups.values()];
  }

  private targetActionIds(): string[] {
    if (!this.targetGroupId) return [];
    return [...this.candidates.entries()]
      .filter(([actionId, candidate]) =>
        candidate.groupId === this.targetGroupId &&
        (!this.eligibleActionIds || this.eligibleActionIds.has(actionId))
      )
      .map(([actionId]) => actionId);
  }

  private visitDurationMs(): number {
    if (this.destination !== "screen") return PET_CAMEO_DURATION_MS;
    return this.screenMode === "peek" ? PET_SCREEN_PEEK_DURATION_MS : PET_SCREEN_STAY_DURATION_MS;
  }

  private takeTileEdge(): PetCameoEdge {
    if (!this.remainingTileEdges.length) {
      this.remainingTileEdges = ["left", "right", "top", "bottom"];
    }
    const index = Math.min(
      this.remainingTileEdges.length - 1,
      Math.floor(this.random() * this.remainingTileEdges.length)
    );
    return this.remainingTileEdges.splice(index, 1)[0]!;
  }

  private beginReturn(nowMs: number): void {
    this.phase = "returning";
    this.phaseStartedAt = nowMs;
  }

  private scheduleNext(nowMs: number): void {
    this.nextCameoAt = this.candidates.size ? nowMs + PET_CAMEO_REST_MS : Number.POSITIVE_INFINITY;
  }
}

export const petRoamer = new PetRoamer();
