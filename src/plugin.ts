import streamDeck from "@elgato/streamdeck";
import { dashboard } from "./dashboard.js";
import {
  ControlAction,
  ConsoleAction,
  GoalAction,
  PetAction,
  RateLimitAction,
  RecentTaskAction,
  RefreshAction,
  StatusAction,
  UsageAction
} from "./actions.js";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new PetAction());
streamDeck.actions.registerAction(new ConsoleAction());
streamDeck.actions.registerAction(new RecentTaskAction());
streamDeck.actions.registerAction(new GoalAction());
streamDeck.actions.registerAction(new UsageAction());
streamDeck.actions.registerAction(new RateLimitAction());
streamDeck.actions.registerAction(new ControlAction());
streamDeck.actions.registerAction(new StatusAction());
streamDeck.actions.registerAction(new RefreshAction());

process.on("SIGTERM", () => dashboard.data.stop());
process.on("SIGINT", () => dashboard.data.stop());

await streamDeck.connect();
streamDeck.logger.info("Streamdex connected");
