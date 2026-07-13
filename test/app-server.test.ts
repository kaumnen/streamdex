import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../src/app-server.js";
import type { UsageSummary } from "../src/model.js";

test("Codex client completes the app-server handshake", async () => {
  const fixture = fileURLToPath(new URL("fixtures/fake-codex.mjs", import.meta.url));
  const client = new CodexAppServerClient(fixture);

  try {
    const usage = await client.call<UsageSummary>("account/usage/read");
    assert.equal(usage.summary.lifetimeTokens, 42);
  } finally {
    client.stop();
  }
});
