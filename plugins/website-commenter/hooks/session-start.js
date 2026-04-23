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

// No additionalContext: port discovery is deferred to the /website-commenter skill,
// which calls get_bridge_port on this session's bridge via MCP (session-scoped, always correct).
