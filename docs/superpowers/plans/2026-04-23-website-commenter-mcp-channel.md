# Website Commenter MCP Channel Integration (Interrupt Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the website-commenter bridge as an MCP server in `plugin.json` so Claude Code auto-spawns it, and fire `notifications/claude/channel` immediately when the browser extension posts a comment — interrupting Claude's current work to apply the change.

**Architecture:** The bridge process runs two transports simultaneously: `Bun.serve()` on a dynamic HTTP port (for the browser extension) and an `@modelcontextprotocol/sdk` `StdioServerTransport` (for Claude Code). When the extension POSTs a comment, the HTTP handler fires a `notifications/claude/channel` notification over stdio, triggering an immediate Claude interrupt. The `WC_NO_MCP=1` env flag suppresses MCP transport initialization during tests (where stdio is ignored).

**Tech Stack:** Bun, `@modelcontextprotocol/sdk` ^1.12, TypeScript (Bun native), `bun:test`

---

## File Map

| File                                                          | Action | Purpose                                                   |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `plugins/website-commenter/package.json`                      | Modify | Add `@modelcontextprotocol/sdk` runtime dependency        |
| `plugins/website-commenter/bridge/server.ts`                  | Modify | Add MCP server + tools + channel push + `WC_NO_MCP` guard |
| `plugins/website-commenter/bridge/server.test.ts`             | Modify | Add `WC_NO_MCP: "1"` to spawn env                         |
| `plugins/website-commenter/.claude-plugin/plugin.json`        | Modify | Add `mcpServers` entry                                    |
| `plugins/website-commenter/hooks/session-start.js`            | Modify | Remove launcher; keep port-surfacing additionalContext    |
| `plugins/website-commenter/skills/website-commenter/SKILL.md` | Modify | Bridge auto-starts — just read port and show it           |
| `plugins/website-commenter/skills/website-comments/SKILL.md`  | Modify | Mark as fallback for when channel is unavailable          |

---

## Task 1: Install MCP SDK and guard tests

**Files:**

- Modify: `plugins/website-commenter/package.json`
- Modify: `plugins/website-commenter/bridge/server.test.ts`

- [ ] **Step 1: Add `@modelcontextprotocol/sdk` to dependencies**

```bash
cd plugins/website-commenter && bun add @modelcontextprotocol/sdk
```

Expected: `package.json` now has `"@modelcontextprotocol/sdk": "^1.12.0"` (or current latest) under `dependencies` (not `devDependencies`).

- [ ] **Step 2: Verify package.json looks correct**

```bash
cat plugins/website-commenter/package.json
```

Expected output:

```json
{
  "name": "website-commenter-bridge",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "devDependencies": {
    "bun-types": "^1.3.13"
  }
}
```

- [ ] **Step 3: Add `WC_NO_MCP: "1"` to test spawn env**

In `plugins/website-commenter/bridge/server.test.ts`, locate the `beforeAll` block:

```typescript
beforeAll(async () => {
  proc = Bun.spawn(
    ["bun", import.meta.dir + "/server.ts", "--port", String(TEST_PORT)],
    {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, WC_NO_STATE_FILE: "1" },
    },
  );
  await Bun.sleep(500); // wait for server to bind
});
```

Change the env line to:

```typescript
      env: { ...process.env, WC_NO_STATE_FILE: "1", WC_NO_MCP: "1" },
```

The full updated `beforeAll`:

```typescript
beforeAll(async () => {
  proc = Bun.spawn(
    ["bun", import.meta.dir + "/server.ts", "--port", String(TEST_PORT)],
    {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, WC_NO_STATE_FILE: "1", WC_NO_MCP: "1" },
    },
  );
  await Bun.sleep(500); // wait for server to bind
});
```

- [ ] **Step 4: Run tests to verify they still pass**

```bash
cd plugins/website-commenter && bun test bridge/server.test.ts
```

Expected: 8 tests pass (the `WC_NO_MCP` env var is not yet read by server.ts, so no change in behaviour — tests pass as before).

- [ ] **Step 5: Commit**

```bash
cd /Users/ephandor/Documents/GitHub/agent-plugins
git add plugins/website-commenter/package.json plugins/website-commenter/bun.lock plugins/website-commenter/bridge/server.test.ts
git commit -m "feat: add @modelcontextprotocol/sdk dep + WC_NO_MCP test guard"
```

---

## Task 2: Add MCP server, tools, and channel notifications to bridge

**Files:**

- Modify: `plugins/website-commenter/bridge/server.ts`

This is a full replacement of `server.ts` that merges the existing dynamic-port + state-file architecture with the new MCP server layer.

- [ ] **Step 1: Write the failing test**

Verify the test file already covers the behaviour we must not break. Run once to confirm the current baseline:

```bash
cd plugins/website-commenter && bun test bridge/server.test.ts
```

Expected: 8 tests pass. These are the tests that must keep passing after the rewrite.

- [ ] **Step 2: Replace `server.ts` with the merged implementation**

Overwrite `plugins/website-commenter/bridge/server.ts` with:

```typescript
// plugins/website-commenter/bridge/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findAvailablePort } from "./find-port";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

export const STATE_FILE = "/tmp/claude-wc-bridge.json";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ElementData {
  selector: string;
  outerHTML: string;
  tagName: string;
  id?: string;
  classNames: string[];
  textContent: string;
  computedStyles: {
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    width: string;
    height: string;
    padding: string;
    margin: string;
    borderRadius: string;
    opacity: string;
  };
}

export interface WebsiteComment {
  id: string;
  url: string;
  pageTitle: string;
  timestamp: string;
  comment: string;
  element: ElementData;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export function isValidComment(obj: unknown): obj is WebsiteComment {
  if (typeof obj !== "object" || obj === null) return false;
  const c = obj as Record<string, unknown>;
  if (
    typeof c.id !== "string" ||
    typeof c.url !== "string" ||
    typeof c.pageTitle !== "string" ||
    typeof c.timestamp !== "string" ||
    typeof c.comment !== "string" ||
    typeof c.element !== "object" ||
    c.element === null
  )
    return false;
  const el = c.element as Record<string, unknown>;
  return (
    typeof el.selector === "string" &&
    typeof el.outerHTML === "string" &&
    typeof el.tagName === "string" &&
    typeof el.textContent === "string" &&
    Array.isArray(el.classNames)
  );
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const fail = (msg: string, status = 400): Response =>
  json({ error: msg }, status);

// ── In-memory store ───────────────────────────────────────────────────────────

const store: WebsiteComment[] = [];

// ── MCP server + channel notifications ───────────────────────────────────────

const skipMcp = process.env.WC_NO_MCP === "1";
let channelActive = false;
let mcpServer: Server | null = null;

if (!skipMcp) {
  mcpServer = new Server(
    { name: "website-commenter", version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: `Website comments arrive as channel notifications from the browser extension.
When a notification arrives, IMMEDIATELY stop current work and apply the requested change to the codebase.
Each notification contains the user's comment, the page URL, the CSS selector of the targeted element,
truncated outer HTML, and computed styles.
Use get_website_comments to poll manually. Use clear_website_comments after processing to acknowledge receipt.`,
    },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_website_comments",
        description:
          "Returns all pending website comments from the browser extension. " +
          "Fallback for when channel notifications are unavailable.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum comments to return (default: all)",
            },
          },
          required: [],
        },
      },
      {
        name: "clear_website_comments",
        description:
          "Clears pending website comments. Call after processing to acknowledge receipt.",
        inputSchema: {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific IDs to clear. Omit to clear all.",
            },
          },
          required: [],
        },
      },
    ],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "get_website_comments") {
      const limit = typeof args?.limit === "number" ? args.limit : undefined;
      const comments =
        limit !== undefined ? store.slice(0, limit) : store.slice();
      if (comments.length === 0) {
        return { content: [{ type: "text", text: "No pending comments." }] };
      }
      const text = comments
        .map(
          (c, i) =>
            `--- Comment ${i + 1} (id: ${c.id}) ---\n` +
            `URL: ${c.url}\n` +
            `Page: ${c.pageTitle}\n` +
            `Element: <${c.element.tagName}> (selector: ${c.element.selector})\n` +
            `Comment: ${c.comment}\n` +
            `HTML: ${c.element.outerHTML.substring(0, 300)}`,
        )
        .join("\n\n");
      return {
        content: [
          { type: "text", text: `${comments.length} comment(s):\n\n${text}` },
        ],
      };
    }

    if (name === "clear_website_comments") {
      const ids = Array.isArray(args?.ids) ? (args.ids as string[]) : undefined;
      if (ids !== undefined) {
        const idSet = new Set(ids);
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i--) {
          if (idSet.has(store[i].id)) store.splice(i, 1);
        }
        const cleared = before - store.length;
        return {
          content: [
            {
              type: "text",
              text: `Cleared ${cleared} comment(s). ${store.length} remaining.`,
            },
          ],
        };
      }
      const count = store.length;
      store.splice(0, store.length);
      return {
        content: [{ type: "text", text: `Cleared all ${count} comment(s).` }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });
}

// ── Channel push helper ───────────────────────────────────────────────────────

async function pushChannelNotification(comment: WebsiteComment): Promise<void> {
  if (!mcpServer || !channelActive) return;
  try {
    await mcpServer.notification({
      method: "notifications/claude/channel",
      params: {
        content:
          `New website comment on ${comment.url}:\n` +
          `"${comment.comment}"\n` +
          `Element: <${comment.element.tagName}> ${comment.element.selector}\n` +
          `HTML: ${comment.element.outerHTML.substring(0, 300)}`,
        meta: {
          url: comment.url,
          page_title: comment.pageTitle,
          selector: comment.element.selector,
          element_tag: comment.element.tagName,
          element_html: comment.element.outerHTML.substring(0, 300),
          comment_id: comment.id,
          comment_text: comment.comment,
        },
      },
    });
  } catch (err) {
    console.error("[bridge] channel push failed:", err);
  }
}

// ── Port resolution ───────────────────────────────────────────────────────────

const portArgIdx = process.argv.indexOf("--port");
const portArg =
  portArgIdx !== -1 ? parseInt(process.argv[portArgIdx + 1], 10) : NaN;
const port =
  !isNaN(portArg) && portArg > 0 && portArg < 65536
    ? portArg
    : await findAvailablePort();

// ── HTTP server ────────────────────────────────────────────────────────────────

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    if (req.method === "GET" && pathname === "/health")
      return json({
        status: "ok",
        commentCount: store.length,
        port,
        channelActive,
      });

    if (req.method === "GET" && pathname === "/comments")
      return json(store.slice());

    if (req.method === "DELETE" && pathname === "/comments") {
      const count = store.length;
      store.splice(0, store.length);
      return json({ cleared: count });
    }

    if (req.method === "POST" && pathname === "/comments") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return fail("Invalid JSON");
      }
      if (!isValidComment(body))
        return fail("Invalid comment shape — missing required fields");
      store.push(body);
      console.error(`[bridge] comment id=${body.id} url=${body.url}`);
      pushChannelNotification(body).catch(() => {});
      return json({ ok: true, id: body.id }, 201);
    }

    if (req.method === "POST" && pathname === "/comments/batch") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return fail("Invalid JSON");
      }
      if (!Array.isArray(body)) return fail("Expected array of comments");
      const valid = (body as unknown[]).filter(isValidComment);
      const rejected = body.length - valid.length;
      for (const c of valid) store.push(c);
      console.error(
        `[bridge] batch accepted=${valid.length} rejected=${rejected}`,
      );
      if (valid.length > 0) {
        pushChannelNotification(valid[0]).catch(() => {});
      }
      return json({ ok: true, accepted: valid.length, rejected }, 201);
    }

    return fail("Not found", 404);
  },
  error: () => fail("Internal server error", 500),
});

// ── State file ─────────────────────────────────────────────────────────────────

const skipStateFile = process.env.WC_NO_STATE_FILE === "1";

if (!skipStateFile) {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      port,
      pid: process.pid,
      started: new Date().toISOString(),
    }),
  );
}
console.error(`[bridge] listening on port ${port}`);

// ── Cleanup ────────────────────────────────────────────────────────────────────

const cleanup = () => {
  if (!skipStateFile && existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  process.exit(0);
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// ── MCP transport (last: stdio must not start before HTTP is ready) ───────────

if (!skipMcp && mcpServer) {
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    channelActive = false;
    console.error("[bridge] MCP transport closed");
  };
  transport.onerror = (err) => {
    console.error("[bridge] MCP transport error:", err);
  };
  mcpServer.oninitialized = () => {
    channelActive = true;
    console.error("[bridge] MCP initialized — channel active");
  };
  await mcpServer.connect(transport);
  console.error("[bridge] MCP server connected via stdio");
}
```

- [ ] **Step 3: Run tests to verify all 8 pass**

```bash
cd plugins/website-commenter && bun test bridge/server.test.ts
```

Expected: 8 tests pass. The `WC_NO_MCP: "1"` env from Task 1 prevents MCP transport from being initialized, so the HTTP server behaves identically to before.

If any test fails, check:

- The health endpoint now returns `channelActive` field — the test only checks specific fields, so this should not break anything
- The batch endpoint now calls `pushChannelNotification(valid[0])` — with `channelActive = false` (MCP skipped), this is a no-op

- [ ] **Step 4: Commit**

```bash
cd /Users/ephandor/Documents/GitHub/agent-plugins
git add plugins/website-commenter/bridge/server.ts
git commit -m "feat: add MCP server + channel notifications to bridge (WC_NO_MCP guard)"
```

---

## Task 3: Register MCP server in plugin.json

**Files:**

- Modify: `plugins/website-commenter/.claude-plugin/plugin.json`

- [ ] **Step 1: Add `mcpServers` block to plugin.json**

Replace the contents of `plugins/website-commenter/.claude-plugin/plugin.json` with:

```json
{
  "name": "website-commenter",
  "description": "Browser extension bridge that lets you comment on DOM elements and send feedback directly to Claude Code. Auto-spawns a bridge server via MCP — channel notifications interrupt Claude immediately when comments arrive.",
  "version": "1.0.0",
  "author": { "name": "Niklas-Flaig" },
  "repository": "https://github.com/wuffig-coding-solutions/website-commenter",
  "license": "MIT",
  "mcpServers": {
    "website-commenter": {
      "command": "bun",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bridge/server.ts"]
    }
  }
}
```

**Why `${CLAUDE_PLUGIN_ROOT}`:** Claude Code expands this env variable to the plugin's installation directory at runtime, the same way it does in `hooks.json` commands. This lets the entry work regardless of where the plugin cache lives.

- [ ] **Step 2: Verify the JSON is valid**

```bash
cat plugins/website-commenter/.claude-plugin/plugin.json | bun -e "process.stdin.resume(); let d=''; process.stdin.on('data', c=>d+=c); process.stdin.on('end', ()=>{ JSON.parse(d); console.log('valid'); })"
```

Expected output: `valid`

- [ ] **Step 3: Commit**

```bash
cd /Users/ephandor/Documents/GitHub/agent-plugins
git add plugins/website-commenter/.claude-plugin/plugin.json
git commit -m "feat: register bridge as MCP server in plugin.json"
```

---

## Task 4: Simplify session-start hook

**Files:**

- Modify: `plugins/website-commenter/hooks/session-start.js`

The bridge is now auto-started by Claude Code as an MCP server. The hook no longer needs to write a launcher script. It should only surface the active port as `additionalContext`.

- [ ] **Step 1: Replace session-start.js with the simplified version**

Overwrite `plugins/website-commenter/hooks/session-start.js` with:

```javascript
#!/usr/bin/env bun
// plugins/website-commenter/hooks/session-start.js
//
// Runs at each Claude Code session start.
// The bridge is auto-started by Claude Code via the MCP server registration in plugin.json.
// This hook just surfaces the active port if the state file is already present.

import fs from "node:fs";

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

const STATE_FILE = "/tmp/claude-wc-bridge.json";
let additionalContext = "";

if (fs.existsSync(STATE_FILE)) {
  try {
    const { port } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (port) {
      additionalContext =
        `Website Commenter bridge is active on port ${port}. ` +
        `Enter this port in the Firefox extension to connect. ` +
        `Comments from the extension will interrupt Claude immediately via the MCP channel.`;
    }
  } catch {}
}

if (additionalContext) {
  process.stdout.write(JSON.stringify({ additionalContext }));
}
```

- [ ] **Step 2: Verify the hook runs without errors**

```bash
echo '{}' | bun plugins/website-commenter/hooks/session-start.js
```

Expected: either empty output (if `/tmp/claude-wc-bridge.json` doesn't exist) or a JSON object with `additionalContext`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ephandor/Documents/GitHub/agent-plugins
git add plugins/website-commenter/hooks/session-start.js
git commit -m "refactor: simplify session-start hook — bridge now auto-starts via MCP"
```

---

## Task 5: Update skills

**Files:**

- Modify: `plugins/website-commenter/skills/website-commenter/SKILL.md`
- Modify: `plugins/website-commenter/skills/website-comments/SKILL.md`

### 5a — Update `/website-commenter`

The bridge is now auto-started by Claude Code. This skill no longer needs to start it — just read the port and show it to the user.

- [ ] **Step 1: Replace website-commenter SKILL.md**

Overwrite `plugins/website-commenter/skills/website-commenter/SKILL.md` with:

````markdown
---
name: website-commenter
description: Show the active bridge port so the Firefox extension can connect. Use when the user says "website commenter", "what port", or "connect the extension".
---

# Website Commenter — Connect the Extension

The bridge starts automatically when Claude Code launches (via MCP). To find the port:

## Step 1 — Read the port

Run:

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```
````

If `PORT` is empty, the bridge has not started yet. This can happen on the very first session before the MCP server has initialised. Wait a moment and retry, or restart Claude Code.

## Step 2 — Display connection instructions

Tell the user:

> The Website Commenter bridge is running on port **{PORT}**.
>
> **In the Firefox extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> Once connected, any comment you send from the extension will **immediately interrupt Claude** and apply the change to the codebase — no manual command needed.
>
> Use `/website-comments` as a fallback if the automatic interrupt is not firing.

````

### 5b — Mark `/website-comments` as fallback

- [ ] **Step 2: Prepend fallback notice to website-comments SKILL.md**

Add the following block at the top of `plugins/website-commenter/skills/website-comments/SKILL.md`, immediately after the frontmatter closing `---`:

```markdown

> **Fallback mode.** This skill manually polls and applies comments. Normally, comments from the browser extension interrupt Claude immediately via the MCP channel without any manual command. Use this skill only if the automatic interrupt is not firing (e.g., after a fresh install before Claude Code has restarted, or if the MCP channel is unavailable).

````

The file should look like:

```markdown
---
name: website-comments
description: Fetch and process pending DOM element comments sent from the browser extension. Use when the user says "check website comments", "apply website feedback", or asks about pending comments.
---

> **Fallback mode.** This skill manually polls and applies comments. Normally, comments from the browser extension interrupt Claude immediately via the MCP channel without any manual command. Use this skill only if the automatic interrupt is not firing (e.g., after a fresh install before Claude Code has restarted, or if the MCP channel is unavailable).

# Website Comments

## Step 1 — Find the bridge port

...
```

(Keep the rest of the file unchanged.)

- [ ] **Step 3: Commit**

```bash
cd /Users/ephandor/Documents/GitHub/agent-plugins
git add plugins/website-commenter/skills/website-commenter/SKILL.md \
        plugins/website-commenter/skills/website-comments/SKILL.md
git commit -m "docs: update skills for MCP channel interrupt mode"
```

---

## Self-Review

### Spec coverage

| Requirement                                                 | Covered by                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| bridge/server.ts = HTTP + MCP Server (stdio) in one process | Task 2                                                       |
| plugin.json registers bridge as MCP server                  | Task 3                                                       |
| Claude Code auto-spawns bridge per session                  | Task 3 (`mcpServers` entry)                                  |
| Channel notification fires when extension POSTs             | Task 2 (`pushChannelNotification` in POST /comments handler) |
| Interrupt mode (IMMEDIATELY stop work)                      | Task 2 (`instructions` field in Server constructor)          |
| /website-commenter shows port only                          | Task 5a                                                      |
| /website-comments kept as fallback                          | Task 5b                                                      |
| Tests need WC_NO_MCP=1 to skip MCP transport                | Task 1 (env added to spawn) + Task 2 (guard implemented)     |
| session-start hook simplified                               | Task 4                                                       |

### Potential issues

1. **Race condition in session-start hook**: If the hook runs before the MCP server writes its state file, `additionalContext` will be empty on first boot. This is acceptable — the MCP channel will still work. On subsequent sessions the state file will be present.

2. **Health endpoint `channelActive` field**: Tests do not assert on this field, so adding it does not break anything.

3. **`${CLAUDE_PLUGIN_ROOT}` interpolation**: Confirmed supported in `hooks.json` commands by the Explore agent. Assumed supported in `plugin.json` `mcpServers.args` by analogy. If this fails at runtime, the fallback is to keep the session-start hook writing `~/.claude/wc-start.sh` and reference that path instead.

4. **Batch notifications**: The batch handler only fires one channel notification (for the first valid comment). This is intentional to avoid flooding. If needed, can be extended to send one notification per comment.
