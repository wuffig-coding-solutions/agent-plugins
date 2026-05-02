#!/usr/bin/env bun
// plugins/website-commenter/hooks/session-start.js
//
// Runs at each Claude Code session start.
// The bridge is auto-started by Claude Code via the MCP server registration in plugin.json.
// Port is NOT read from the state file here — that file is shared across all sessions and
// would show the wrong port if multiple Claude Code windows are open.
// Use /website-commenter to get the correct port for this session via the get_bridge_port MCP tool.

import fs from "node:fs";

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

// Initialize state file with busy: false so the bridge can detect "hooks are installed"
// from the first moment. This ensures the bridge knows we're in a compatible session.
const STATE_FILE = `/tmp/claude-wc-bridge-${process.ppid}.json`;
try {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      ...current,
      busy: false,
      busyTs: new Date().toISOString(),
    }),
  );
  fs.renameSync(tmp, STATE_FILE);
} catch {}

// No additionalContext: port discovery is deferred to the /website-commenter skill,
// which calls get_bridge_port on this session's bridge via MCP (session-scoped, always correct).
