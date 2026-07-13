import assert from "node:assert/strict";
import test from "node:test";
import { cardSvg, pairedKeySvg, svgDataUri } from "../src/render.js";
import { escapeXml, formatTokens, relativeTime } from "../src/format.js";
import { petDetailSvg, petPanelSvg, petView } from "../src/pet.js";
import { petPose } from "../src/pet-sprite.js";
import { cameoReveal, petCameoOverlay } from "../src/pet-cameo.js";
import {
  PET_CAMEO_DURATION_MS,
  PET_CAMEO_INITIAL_DELAY_MS,
  PET_DEPARTURE_DURATION_MS,
  PET_RETURN_DURATION_MS,
  PET_SCREEN_PEEK_DURATION_MS,
  PET_SCREEN_STAY_DURATION_MS,
  PET_TILE_VISIT_PROBABILITY,
  PetRoamer
} from "../src/pet-roamer.js";
import { codexUrlForThread, RoamingPetLoop, screenPairId, visiblePetSheetActionIds } from "../src/dashboard.js";
import { consolePanelSvg, consoleScene, consoleSceneCount } from "../src/console.js";
import type { DashboardSnapshot } from "../src/model.js";

test("formatTokens keeps dashboard values compact", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_200), "1.20K");
  assert.equal(formatTokens(12_500_000), "12.5M");
});

test("relativeTime summarizes recent activity", () => {
  assert.equal(relativeTime(1_000, 31_000), "30s");
  assert.equal(relativeTime(1_000, 121_000), "2m");
});

test("SVG rendering escapes task titles", () => {
  assert.equal(escapeXml("a < b & c"), "a &lt; b &amp; c");
  const svg = cardSvg({ eyebrow: "TASK", title: "Fix <script>", meta: "now", accent: "#10a37f" });
  assert.match(svg, /Fix &lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svgDataUri(svg), /^data:image\/svg\+xml;base64,/);
});

test("Codex pet reflects active work across two panels", () => {
  const snapshot = petSnapshot({ activeProcesses: 1 });
  const view = petView(snapshot);
  assert.equal(view.mood, "coding");
  assert.match(petPanelSvg(view, 4_900), /viewBox="0 0 200 100"/);
  assert.match(petDetailSvg(view, 4_900), /viewBox="200 0 200 100"/);
  assert.match(petDetailSvg(view, 4_900), /data:image\/webp;base64,/);
  assert.equal(petPose("coding", 4_900).state, "jumping");
});

test("Codex pet escapes selected task text", () => {
  const snapshot = petSnapshot();
  snapshot.threads[0]!.title = "Fix <unsafe> & ship";
  const svg = petDetailSvg(petView(snapshot));
  assert.match(svg, /Fix &lt;unsafe&gt; &amp;/);
  assert.doesNotMatch(svg, /<unsafe>/);
});

test("Codex pet worries about blocked goals", () => {
  const snapshot = petSnapshot();
  snapshot.goals.push({
    threadId: snapshot.threads[0]!.id,
    objective: "Unblock release",
    status: "blocked",
    tokensUsed: 12,
    tokenBudget: null,
    timeUsedSeconds: 30,
    updatedAtMs: 1_000
  });
  assert.equal(petView(snapshot).mood, "worried");
});

test("Codex pet stays calm when local data is unavailable", () => {
  const snapshot = petSnapshot({ dataError: true });
  const view = petView(snapshot);
  assert.equal(view.mood, "confused");
  assert.equal(petPose(view.mood, 4_900).state, "idle");
});

test("Codex pet visits a random visible key then retreats", () => {
  const randomValues = [0.99, 0.75, 0.5, 0, 0.25];
  const roamer = new PetRoamer(() => randomValues.shift() ?? 0);
  roamer.add("first", "tile", 0);
  roamer.add("second", "tile", 0);

  assert.deepEqual(roamer.advance(PET_CAMEO_INITIAL_DELAY_MS - 1), []);
  assert.deepEqual(roamer.advance(PET_CAMEO_INITIAL_DELAY_MS), []);
  assert.equal(roamer.isTraveling, true);
  assert.equal(roamer.homeTravelFor(PET_CAMEO_INITIAL_DELAY_MS).phase, "departing");
  assert.equal(roamer.cameoFor("first", PET_CAMEO_INITIAL_DELAY_MS), null);
  const visitStartedAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  assert.deepEqual(roamer.advance(visitStartedAt), ["second"]);
  assert.equal(roamer.homeTravelFor(visitStartedAt).phase, "away");
  assert.equal(roamer.cameoFor("second", visitStartedAt)?.edge, "bottom");
  assert.equal(roamer.cameoFor("second", visitStartedAt)?.message, "STILL VIBING?");

  assert.deepEqual(
    roamer.advance(visitStartedAt + PET_CAMEO_DURATION_MS),
    ["second"]
  );
  assert.equal(roamer.cameoFor("second", visitStartedAt + PET_CAMEO_DURATION_MS), null);
  assert.equal(roamer.homeTravelFor(visitStartedAt + PET_CAMEO_DURATION_MS).phase, "returning");
  assert.equal(roamer.isTraveling, true);
  roamer.advance(visitStartedAt + PET_CAMEO_DURATION_MS + PET_RETURN_DURATION_MS);
  assert.equal(roamer.isTraveling, false);
});

test("Codex pet cameo peeks from a tile edge", () => {
  const cameo = { destination: "tile" as const, edge: "left" as const, message: "HOW'S IT GOING?", x: 30, y: 43, elapsedMs: 1_600, durationMs: 3_200 };
  assert.equal(cameoReveal(0, cameo.durationMs), 0);
  assert.equal(cameoReveal(cameo.elapsedMs, cameo.durationMs), 1);
  assert.equal(cameoReveal(cameo.durationMs, cameo.durationMs), 0);
  const svg = petCameoOverlay(cameo);
  assert.match(svg, /class="pet-cameo"/);
  assert.doesNotMatch(svg, /class="pet-cameo-bubble"/);
  assert.doesNotMatch(svg, /👋/);
  assert.doesNotMatch(svg, /HOW&apos;S IT|GOING\?/);
  assert.match(svg, /data:image\/webp;base64,/);
});

test("Codex pet can peek down from above a tile", () => {
  const cameo = { destination: "tile" as const, edge: "top" as const, message: "STILL VIBING?", x: 44, y: 43, elapsedMs: 1_600, durationMs: 3_200 };
  const svg = petCameoOverlay(cameo, 144);
  assert.match(svg, /class="pet-cameo"/);
  assert.match(svg, /class="pet-cameo-vertical pet-cameo-top"/);
  assert.match(svg, /y="0\.00"/);
  assert.doesNotMatch(svg, /rotate\(180/);
  assert.doesNotMatch(svg, /👋/);
  assert.doesNotMatch(svg, /STILL|VIBING/);
});

test("Codex pet can peek up from below a tile", () => {
  const cameo = { destination: "tile" as const, edge: "bottom" as const, message: "HI THERE!", x: 30, y: 43, elapsedMs: 1_600, durationMs: 3_200 };
  const svg = petCameoOverlay(cameo);
  assert.match(svg, /class="pet-cameo-vertical pet-cameo-bottom"/);
  assert.match(svg, /y="76\.00"/);
  assert.doesNotMatch(svg, /👋|HI THERE/);
});

test("Codex pet stays fully visible on a dial-strip screen", () => {
  const cameo = { destination: "screen" as const, edge: "right" as const, message: "HOW'S IT GOING?", x: 44, y: 34, elapsedMs: 1_600, durationMs: PET_SCREEN_STAY_DURATION_MS };
  const svg = petCameoOverlay(cameo, 0, 400, 100);
  assert.match(svg, /class="pet-cameo pet-screen-stay"/);
  assert.match(svg, /x="312\.00"/);
  assert.match(svg, /x="204" y="28" width="104" height="40"/);
  assert.match(svg, /HOW&apos;S IT/);
  assert.match(svg, /GOING\?/);
  assert.doesNotMatch(svg, /HOW&apos;S IT GOING\?<\/text>/);
  assert.doesNotMatch(svg, />👋<\/text>/);
  assert.match(svg, /data:image\/webp;base64,/);
});

test("Codex pet runs into and out of a strip visit without fading", () => {
  const base = { destination: "screen" as const, edge: "right" as const, message: "NICE WORK!", x: 44, y: 34, durationMs: PET_SCREEN_STAY_DURATION_MS };
  const arriving = petCameoOverlay({ ...base, elapsedMs: 0 }, 0, 400, 100);
  const settled = petCameoOverlay({ ...base, elapsedMs: 2_000 }, 0, 400, 100);
  const leaving = petCameoOverlay({ ...base, elapsedMs: PET_SCREEN_STAY_DURATION_MS }, 0, 400, 100);

  assert.match(arriving, /x="-88\.00"/);
  assert.doesNotMatch(arriving, /class="pet-cameo-bubble"|NICE|WORK/);
  assert.match(settled, /x="312\.00"/);
  assert.match(settled, /class="pet-cameo-bubble"/);
  assert.match(leaving, /x="-88\.00"/);
  assert.doesNotMatch(leaving, /class="pet-cameo-bubble"|NICE|WORK/);
  assert.doesNotMatch(arriving, /pet-screen-stay"[^>]*opacity=/);
  assert.doesNotMatch(leaving, /pet-screen-stay"[^>]*opacity=/);
});

test("Codex pet can make a short strip peek without a bubble", () => {
  const cameo = {
    destination: "screen" as const,
    screenMode: "peek" as const,
    edge: "right" as const,
    message: "HI THERE!",
    x: 44,
    y: 34,
    elapsedMs: PET_SCREEN_PEEK_DURATION_MS / 2,
    durationMs: PET_SCREEN_PEEK_DURATION_MS
  };
  const svg = petCameoOverlay(cameo, 0, 400, 100);
  assert.match(svg, /class="pet-cameo pet-screen-peek"/);
  assert.match(svg, /x="-22\.00"/);
  assert.doesNotMatch(svg, /pet-cameo-bubble|HI THERE/);
});

test("Codex pet favors tiles four to one when tiles and strips are visible", () => {
  assert.equal(PET_TILE_VISIT_PROBABILITY, 0.8);

  const tileRandom = [PET_TILE_VISIT_PROBABILITY - 0.01, 0, 0, 0, 0];
  const tileRoamer = new PetRoamer(() => tileRandom.shift() ?? 0);
  tileRoamer.add("tile", "tile", 0);
  tileRoamer.add("screen", "screen", 0);
  tileRoamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  assert.equal(tileRoamer.homeTravelFor(PET_CAMEO_INITIAL_DELAY_MS).destination, "tile");

  const screenRandom = [PET_TILE_VISIT_PROBABILITY, 0, 0, 0];
  const screenRoamer = new PetRoamer(() => screenRandom.shift() ?? 0);
  screenRoamer.add("tile", "tile", 0);
  screenRoamer.add("screen", "screen", 0);
  screenRoamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  assert.equal(screenRoamer.homeTravelFor(PET_CAMEO_INITIAL_DELAY_MS).destination, "screen");
});

test("Codex pet uses every tile edge before repeating one", () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("tile", "tile", 0);
  const edges = [];
  let departureAt = PET_CAMEO_INITIAL_DELAY_MS;

  for (let visit = 0; visit < 4; visit += 1) {
    roamer.advance(departureAt);
    const visitAt = departureAt + PET_DEPARTURE_DURATION_MS;
    roamer.advance(visitAt);
    edges.push(roamer.cameoFor("tile", visitAt)?.edge);
    const returnAt = visitAt + PET_CAMEO_DURATION_MS;
    roamer.advance(returnAt);
    const homeAt = returnAt + PET_RETURN_DURATION_MS;
    roamer.advance(homeAt);
    departureAt = homeAt + PET_CAMEO_INITIAL_DELAY_MS;
  }

  assert.deepEqual(edges, ["left", "right", "top", "bottom"]);
});

test("Codex pet makes strip peeks rare and predictable", () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("screen", "screen", 0);
  const modes = [];
  const durations = [];
  let departureAt = PET_CAMEO_INITIAL_DELAY_MS;

  for (let visit = 0; visit < 4; visit += 1) {
    roamer.advance(departureAt);
    const visitAt = departureAt + PET_DEPARTURE_DURATION_MS;
    roamer.advance(visitAt);
    const cameo = roamer.cameoFor("screen", visitAt)!;
    modes.push(cameo.screenMode);
    durations.push(cameo.durationMs);
    const returnAt = visitAt + cameo.durationMs;
    roamer.advance(returnAt);
    const homeAt = returnAt + PET_RETURN_DURATION_MS;
    roamer.advance(homeAt);
    departureAt = homeAt + PET_CAMEO_INITIAL_DELAY_MS;
  }

  assert.deepEqual(modes, ["stay", "stay", "stay", "peek"]);
  assert.deepEqual(durations, [
    PET_SCREEN_STAY_DURATION_MS,
    PET_SCREEN_STAY_DURATION_MS,
    PET_SCREEN_STAY_DURATION_MS,
    PET_SCREEN_PEEK_DURATION_MS
  ]);
});

test("Codex pet drops destinations when their sheet is hidden", () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("old-sheet", "tile", 0);
  roamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  const oldVisitAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  roamer.advance(oldVisitAt);
  assert.notEqual(roamer.cameoFor("old-sheet", oldVisitAt), null);

  const pageChangedAt = oldVisitAt + 100;
  roamer.remove("old-sheet", pageChangedAt);
  roamer.add("current-sheet", "tile", pageChangedAt);
  assert.equal(roamer.cameoFor("old-sheet", pageChangedAt), null);
  assert.equal(roamer.homeTravelFor(pageChangedAt).phase, "returning");

  const homeAt = pageChangedAt + PET_RETURN_DURATION_MS;
  roamer.advance(homeAt);
  const nextDepartureAt = homeAt + PET_CAMEO_INITIAL_DELAY_MS;
  roamer.advance(nextDepartureAt);
  const currentVisitAt = nextDepartureAt + PET_DEPARTURE_DURATION_MS;
  assert.deepEqual(roamer.advance(currentVisitAt), ["current-sheet"]);
});

test("Codex pet ignores stale destinations outside the current sheet", () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("stale-sheet", "tile", 0);
  roamer.add("current-sheet", "tile", 0);
  roamer.setEligibleActionIds(["current-sheet"], 0);

  roamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  const visitAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  assert.deepEqual(roamer.advance(visitAt), ["current-sheet"]);
  assert.equal(roamer.cameoFor("stale-sheet", visitAt), null);
});

test("Codex pet limits visible destinations to sheets with a visible home", () => {
  const action = (id: string, manifestId: string, deviceId: string) => ({
    id,
    manifestId,
    device: { id: deviceId }
  });
  const visibleIds = visiblePetSheetActionIds([
    action("pet-home", "com.kaumnen.streamdex.pet", "current-device"),
    action("current-tile", "com.kaumnen.streamdex.goal", "current-device"),
    action("other-tile", "com.kaumnen.streamdex.goal", "other-device")
  ]);

  assert.deepEqual(visibleIds, ["pet-home", "current-tile"]);
});

test("Codex pet patrol stays inside a paired strip without position resets", () => {
  let previousX = petPose("ready", 0).x;
  for (let nowMs = 100; nowMs <= 14_000; nowMs += 100) {
    const x = petPose("ready", nowMs).x;
    assert.ok(x >= 8 && x <= 306, `ready x=${x} at ${nowMs}ms`);
    assert.ok(Math.abs(x - previousX) < 10, `ready pose jumped from ${previousX} to ${x} at ${nowMs}ms`);
    previousX = x;
  }
});

test("Codex pet runs out of and back into its paired home scene", () => {
  const view = petView(petSnapshot());
  const home = petPanelSvg(view, 1_600);
  const departureStart = petPanelSvg(view, 1_600, {
    phase: "departing", edge: "left", elapsedMs: 0, durationMs: 1_200
  });
  const departing = petPanelSvg(view, 1_600, {
    phase: "departing", edge: "left", elapsedMs: 600, durationMs: 1_200
  });
  const awayTravel = {
    phase: "away" as const,
    edge: "left" as const,
    elapsedMs: PET_CAMEO_DURATION_MS / 2,
    durationMs: PET_CAMEO_DURATION_MS,
    destination: "screen" as const
  };
  const away = petPanelSvg(view, 1_600, awayTravel);
  const awayDetail = petDetailSvg(view, 1_600, awayTravel);
  const awayStart = petPanelSvg(view, 1_600, { ...awayTravel, elapsedMs: 0 });
  const awayEnd = petPanelSvg(view, 1_600, { ...awayTravel, elapsedMs: PET_CAMEO_DURATION_MS });
  const returning = petPanelSvg(view, 1_600, {
    phase: "returning", edge: "left", elapsedMs: 550, durationMs: 1_100
  });
  const rightExit = petDetailSvg(view, 1_600, {
    phase: "departing", edge: "right", elapsedMs: 1_200, durationMs: 1_200
  });
  const returnEnd = petPanelSvg(view, 1_600, {
    phase: "returning", edge: "left", elapsedMs: 1_100, durationMs: 1_100
  });
  const resumeX = petPose(view.mood, 1_600).x.toFixed(2);
  assert.match(home, /<image href="data:image\/webp;base64,/);
  assert.match(departing, /class="pet-home-travel"/);
  assert.match(departing, /class="pet-home-travel">\s*<image/);
  assert.match(returning, /class="pet-home-travel"/);
  assert.match(departureStart, new RegExp(`class="pet-home-travel"[\\s\\S]*x="${resumeX}"`));
  assert.match(returnEnd, new RegExp(`class="pet-home-travel"[\\s\\S]*x="${resumeX}"`));
  assert.match(rightExit, /x="402\.00"/);
  assert.doesNotMatch(rightExit, /x="202\.00"/);
  assert.doesNotMatch(away, /<image href="data:image\/webp;base64,/);
  assert.match(away, /class="pet-away-status"/);
  assert.match(away, /x="22" y="48" width="356"/);
  assert.match(away, /OUT EXPLORING/);
  assert.match(awayDetail, /CURRENT STOP/);
  assert.match(awayDetail, /STRIP CHECK-IN/);
  assert.match(away, /<circle cx="43" cy="66" r="9"/);
  assert.match(awayStart, /class="pet-away-status" opacity="0\.00"/);
  assert.match(awayEnd, /class="pet-away-status" opacity="0\.00"/);
  assert.doesNotMatch(away, /stroke-dasharray/);
});

test("Codex pet treats dial screens as longer trips", () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("screen", "screen", 0);
  roamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  const visitStartedAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  roamer.advance(visitStartedAt);
  assert.equal(roamer.cameoFor("screen", visitStartedAt)?.destination, "screen");
  assert.equal(roamer.cameoFor("screen", visitStartedAt)?.screenMode, "stay");
  assert.equal(roamer.cameoFor("screen", visitStartedAt)?.durationMs, PET_SCREEN_STAY_DURATION_MS);
  assert.deepEqual(roamer.advance(visitStartedAt + PET_CAMEO_DURATION_MS), ["screen"]);
  const away = roamer.homeTravelFor(visitStartedAt + PET_CAMEO_DURATION_MS);
  assert.equal(away.phase, "away");
  assert.equal(away.elapsedMs, PET_CAMEO_DURATION_MS);
  assert.equal(away.destination, "screen");
});

test("Codex pet treats each adjacent dial pair as one continuous room", () => {
  assert.equal(screenPairId("deck", 0), screenPairId("deck", 1));
  assert.notEqual(screenPairId("deck", 1), screenPairId("deck", 2));

  const roamer = new PetRoamer(() => 0);
  const pairId = screenPairId("deck", 2);
  roamer.add("left-panel", "screen", 0, pairId);
  roamer.add("right-panel", "screen", 0, pairId);
  roamer.advance(PET_CAMEO_INITIAL_DELAY_MS);
  const visitStartedAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  assert.deepEqual(roamer.advance(visitStartedAt), ["left-panel", "right-panel"]);
  assert.equal(roamer.cameoFor("left-panel", visitStartedAt)?.destination, "screen");
  assert.equal(roamer.cameoFor("right-panel", visitStartedAt)?.destination, "screen");

  roamer.remove("left-panel", visitStartedAt + 100);
  assert.notEqual(roamer.cameoFor("right-panel", visitStartedAt + 100), null);
  assert.deepEqual(roamer.advance(visitStartedAt + 100), ["right-panel"]);
});

test("Codex pet travel clock advances while a strip render is in flight", async () => {
  const roamer = new PetRoamer(() => 0);
  roamer.add("screen", "screen", 0);
  let releaseRender!: () => void;
  const blockedRender = new Promise<void>((resolve) => {
    releaseRender = resolve;
  });
  let renderCalls = 0;
  const loop = new RoamingPetLoop(
    roamer,
    () => ["screen"],
    async () => {
      renderCalls += 1;
      await blockedRender;
    }
  );

  await loop.tick(PET_CAMEO_INITIAL_DELAY_MS);
  const visitStartedAt = PET_CAMEO_INITIAL_DELAY_MS + PET_DEPARTURE_DURATION_MS;
  const firstRender = loop.tick(visitStartedAt);
  await Promise.resolve();
  assert.equal(renderCalls, 1);

  const returnStartedAt = visitStartedAt + PET_SCREEN_STAY_DURATION_MS;
  await loop.tick(returnStartedAt);
  await loop.tick(returnStartedAt + PET_RETURN_DURATION_MS);
  assert.equal(roamer.isTraveling, false);
  assert.equal(roamer.homeTravelFor(returnStartedAt + PET_RETURN_DURATION_MS).phase, "home");

  releaseRender();
  await firstRender;
  assert.equal(renderCalls, 2);
});

test("active task buttons focus Codex without resuming a live writer", () => {
  const snapshot = petSnapshot({ activeProcesses: 1 });
  const thread = snapshot.threads[0]!;
  thread.active = true;
  assert.equal(codexUrlForThread(snapshot, thread.id), "codex://");
  thread.active = false;
  assert.equal(codexUrlForThread(snapshot, thread.id), `codex://threads/${thread.id}`);
  assert.equal(codexUrlForThread(snapshot, "not-a-thread"), null);
});

test("paired usage console cycles four ranges across two panels", () => {
  const snapshot = petSnapshot();
  snapshot.usage = {
    dailyUsageBuckets: [{ startDate: "2026-07-13", tokens: 42_000 }],
    summary: { lifetimeTokens: 228_000_000, peakDailyTokens: 102_000_000, currentStreakDays: 3 }
  };
  const scene = consoleScene("usage", 0, snapshot);
  assert.equal(consoleSceneCount("usage", snapshot), 4);
  assert.equal(scene.title, "42.0K tokens");
  assert.match(consolePanelSvg(scene, 0), /viewBox="0 0 200 100"/);
  assert.match(consolePanelSvg(scene, 1), /viewBox="200 0 200 100"/);
});

test("paired status console keeps long goal text safe and visible", () => {
  const snapshot = petSnapshot();
  snapshot.goals.push({
    threadId: snapshot.threads[0]!.id,
    objective: "Ship <paired> dashboard with more readable task context",
    status: "active",
    tokensUsed: 12_500,
    tokenBudget: 50_000,
    timeUsedSeconds: 3_720,
    updatedAtMs: 1_000
  });
  const svg = consolePanelSvg(consoleScene("status", 0, snapshot), 0);
  assert.match(svg, /Ship &lt;paired&gt; dashboard/);
  assert.doesNotMatch(svg, /<paired>/);
  assert.equal(consoleSceneCount("status", snapshot), 2);
});

test("paired keys split context and result across adjacent buttons", () => {
  const card = {
    accent: "#10a37f",
    left: { eyebrow: "TASK 1", value: "RUNNING NOW", meta: "13.5M · 1m" },
    right: { eyebrow: "CURRENT TASK", value: "Fix <wide> key layout", meta: "press either to open" }
  };
  assert.match(pairedKeySvg(card, 0), /viewBox="0 0 144 144"/);
  assert.match(pairedKeySvg(card, 1), /viewBox="144 0 144 144"/);
  assert.match(pairedKeySvg(card, 1), /Fix &lt;wide&gt;/);
});

function petSnapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    threads: [{
      id: "11111111-1111-4111-8111-111111111111",
      title: "Build the companion dashboard",
      tokensUsed: 1_200,
      updatedAtMs: Date.now(),
      active: Boolean(overrides.activeProcesses)
    }],
    goals: [],
    usage: null,
    rateLimits: null,
    localTokens: 1_200,
    activeProcesses: 0,
    refreshedAt: Date.now(),
    source: "local",
    dataError: false,
    ...overrides
  };
}
