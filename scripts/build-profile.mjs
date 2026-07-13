import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const profileFolder = "b66331e7-b58f-4d97-8668-66f628d49473.sdProfile";
const source = resolve("profile", profileFolder);
const output = resolve("com.kaumnen.streamdex.sdPlugin/profiles/Streamdex.streamDeckProfile");
const staging = resolve(".profile-build");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(source, resolve(staging, profileFolder), { recursive: true });
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
execFileSync("/usr/bin/zip", ["-q", "-r", output, profileFolder, "-x", "*.DS_Store", "*/._*"], {
  cwd: staging,
  env: { ...process.env, COPYFILE_DISABLE: "1" }
});
rmSync(staging, { recursive: true, force: true });
