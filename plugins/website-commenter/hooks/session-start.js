#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import fs from "node:fs";

// Consume stdin (required by hook contract)
let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) process.exit(0);

// Install deps on first run (bun install is fast and idempotent)
if (!existsSync(`${pluginRoot}/node_modules`)) {
  try {
    execSync("bun install --frozen-lockfile", {
      cwd: pluginRoot,
      stdio: "ignore",
    });
  } catch {
    process.exit(0);
  }
}

// Check if bridge server is already running
let bridgeRunning = false;
try {
  const res = await fetch("http://localhost:8789/health", {
    signal: AbortSignal.timeout(1000),
  });
  bridgeRunning = res.ok;
} catch {}

if (!bridgeRunning) {
  // Spawn bridge server as a detached background process
  Bun.spawn(["bun", "run", `${pluginRoot}/bridge/server.ts`], {
    cwd: pluginRoot,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  // Brief pause to let the HTTP listener bind
  await Bun.sleep(300);
}

// Check pending comment count to include in context
let commentCount = 0;
try {
  const res = await fetch("http://localhost:8789/health", {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    const data = await res.json();
    commentCount = data.commentCount ?? 0;
  }
} catch {}

const countNote =
  commentCount > 0
    ? ` There are currently ${commentCount} pending comment(s) — use /website-comments to process them.`
    : "";

process.stdout.write(
  JSON.stringify({
    additionalContext: `Website Commenter bridge is running on localhost:8789. The browser extension can send DOM element annotations to this session.${countNote} Use /website-comments to fetch and act on pending comments.`,
  }),
);
