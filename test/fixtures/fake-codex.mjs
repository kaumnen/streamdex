#!/usr/bin/env node
import { createInterface } from "node:readline";

let initialized = false;

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, {});
    return;
  }
  if (message.method === "initialized") {
    initialized = true;
    return;
  }
  if (message.method === "account/usage/read" && initialized && !("params" in message)) {
    respond(message.id, { summary: { lifetimeTokens: 42 }, dailyUsageBuckets: [] });
    return;
  }
  respond(message.id, undefined, "Invalid app-server handshake");
});

function respond(id, result, error) {
  const message = error ? { id, error: { message: error } } : { id, result };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
