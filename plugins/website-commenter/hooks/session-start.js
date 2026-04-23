#!/usr/bin/env bun
// plugins/website-commenter/hooks/session-start.js
//
// Runs at each Claude Code session start. Does two things:
//   1. Writes ~/.claude/wc-start.sh so /website-commenter skill can start the
//      bridge without knowing the plugin's cache install path.
//   2. Checks if bridge is already running and surfaces it as additionalContext.

import fs from "node:fs";

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const home = process.env.HOME;

// ── 1. Write launcher ─────────────────────────────────────────────────────────

if (pluginRoot && home) {
  const launcher = `#!/usr/bin/env bash\nexec bun "${pluginRoot}/bridge/server.ts" "$@"\n`;
  try {
    fs.writeFileSync(`${home}/.claude/wc-start.sh`, launcher, { mode: 0o755 });
  } catch (e) {
    console.error("[website-commenter] Failed to write launcher:", e);
  }
}

// ── 2. Check bridge status ────────────────────────────────────────────────────

const STATE_FILE = "/tmp/claude-wc-bridge.json";
let additionalContext = "";

if (fs.existsSync(STATE_FILE)) {
  let port = null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    port = state.port;
  } catch {}

  if (port) {
    let healthy = false;
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      healthy = res.ok;
    } catch {}

    if (healthy) {
      additionalContext = `Website Commenter bridge is active on port ${port}. Use /website-comments to fetch and apply pending feedback from the browser extension.`;
    } else {
      // Stale state file — bridge crashed. Remove it.
      try {
        fs.unlinkSync(STATE_FILE);
      } catch {}
    }
  }
}

if (additionalContext) {
  process.stdout.write(JSON.stringify({ additionalContext }));
}
