import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const profilePath = process.argv[2];
if (!profilePath) throw new Error("Usage: node scripts/apply-paired-console-profile.mjs <profile.sdProfile>");

const pagesPath = join(profilePath, "Profiles");
for (const pageId of await readdir(pagesPath)) {
  const manifestPath = join(pagesPath, pageId, "manifest.json");
  let page;
  try {
    page = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    continue;
  }

  const encoder = page.Controllers?.find((controller) => controller.Type === "Encoder");
  const keypad = page.Controllers?.find((controller) => controller.Type === "Keypad");
  if (!encoder || !keypad) continue;
  if (page.Name === "Tasks") {
    configureKey(keypad.Actions?.["0,0"], "Task Context", { panel: 0, slot: 0 });
    configureKey(keypad.Actions?.["1,0"], "Task Result", { panel: 1, slot: 0 });
    configureKey(keypad.Actions?.["2,0"], "Task Context", { panel: 0, slot: 1 });
    configureKey(keypad.Actions?.["3,0"], "Task Result", { panel: 1, slot: 1 });
    configure(encoder.Actions?.["2,0"], "Status Console Left", "status", 0);
    configure(encoder.Actions?.["3,0"], "Status Console Right", "status", 1);
  } else if (page.Name === "Insights") {
    configureKey(keypad.Actions?.["0,0"], "Usage Range", { index: 0, panel: 0 });
    configureKey(keypad.Actions?.["1,0"], "Usage Result", { index: 0, panel: 1 });
    configureKey(keypad.Actions?.["2,0"], "Lifetime Range", { index: 3, panel: 0 });
    configureKey(keypad.Actions?.["3,0"], "Lifetime Result", { index: 3, panel: 1 });
    configure(encoder.Actions?.["0,0"], "Usage Console Left", "usage", 0);
    configure(encoder.Actions?.["1,0"], "Usage Console Right", "usage", 1);
    configure(encoder.Actions?.["2,0"], "Status Console Left", "status", 0);
    configure(encoder.Actions?.["3,0"], "Status Console Right", "status", 1);
  } else {
    continue;
  }
  await writeFile(manifestPath, JSON.stringify(page));
}

function configure(action, name, group, panel) {
  if (!action) throw new Error(`Missing encoder action for ${name}`);
  action.Name = name;
  action.Settings = { group, index: 0, panel };
  action.UUID = "com.kaumnen.streamdex.console";
}

function configureKey(action, name, settings) {
  if (!action) throw new Error(`Missing keypad action for ${name}`);
  action.Name = name;
  action.Settings = settings;
}
