# Website Commenter — Session-Scoped Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-starting shared bridge with an explicit, per-session bridge launched via `/website-commenter` skill, with a dynamic port the user pastes into the Firefox extension, and a live indicator in the Claude Code status bar.

**Architecture:** The `/website-commenter` skill runs `~/.claude/wc-start.sh` (a launcher written by the session-start hook, containing the plugin's absolute install path). `bridge/server.ts` finds a free port in 8780–8799, writes `{ port, pid, started }` to `/tmp/claude-wc-bridge.json`, and serves HTTP. The status line reads that state file to show `⬡ :PORT`. The session-start hook surfaces bridge status as `additionalContext` if already running.

**Tech Stack:** Bun, TypeScript, `Bun.serve()`, `bun test`

---

## File Map

| File                                                          | Action  | Responsibility                                          |
| ------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `plugins/website-commenter/bridge/find-port.ts`               | Create  | Find first free port in 8780–8799                       |
| `plugins/website-commenter/bridge/find-port.test.ts`          | Create  | Unit tests for port finder                              |
| `plugins/website-commenter/bridge/server.ts`                  | Rewrite | HTTP-only bridge; `--port` arg; state file lifecycle    |
| `plugins/website-commenter/bridge/server.test.ts`             | Create  | Integration tests via subprocess                        |
| `plugins/website-commenter/skills/website-commenter/SKILL.md` | Create  | Start bridge + display port to user                     |
| `plugins/website-commenter/skills/website-comments/SKILL.md`  | Modify  | Read port from state file instead of hard-coded 8789    |
| `plugins/website-commenter/hooks/session-start.js`            | Rewrite | Write launcher script; surface active bridge as context |
| `plugins/website-commenter/package.json`                      | Modify  | Remove `@modelcontextprotocol/sdk` and `zod`            |
| `~/.claude/statusline-command.sh`                             | Modify  | Prepend `⬡ :PORT` indicator when state file present     |

---

### Task 1: Create find-port.ts and tests

**Files:**

- Create: `plugins/website-commenter/bridge/find-port.ts`
- Create: `plugins/website-commenter/bridge/find-port.test.ts`

- [ ] **Step 1: Create find-port.ts**

```typescript
// plugins/website-commenter/bridge/find-port.ts
/**
 * Finds the first available TCP port in [start, end] by attempting to bind.
 * When run directly (`bun bridge/find-port.ts`), prints the port to stdout.
 */
export async function findAvailablePort(
  start = 8780,
  end = 8799,
): Promise<number> {
  for (let port = start; port <= end; port++) {
    try {
      const s = Bun.serve({ port, fetch: () => new Response("ok") });
      s.stop(true);
      return port;
    } catch {
      // port in use, try next
    }
  }
  throw new Error(`No available port in range ${start}–${end}`);
}

if (import.meta.main) {
  const port = await findAvailablePort();
  process.stdout.write(port + "\n");
}
```

- [ ] **Step 2: Create find-port.test.ts**

```typescript
// plugins/website-commenter/bridge/find-port.test.ts
import { test, expect, afterEach } from "bun:test";
import { findAvailablePort } from "./find-port";

const occupied: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  occupied.forEach((s) => s.stop(true));
  occupied.length = 0;
});

test("returns a port in range when all are free", async () => {
  const port = await findAvailablePort(8780, 8799);
  expect(port).toBeGreaterThanOrEqual(8780);
  expect(port).toBeLessThanOrEqual(8799);
});

test("skips occupied ports", async () => {
  const busy = Bun.serve({ port: 8780, fetch: () => new Response("busy") });
  occupied.push(busy);
  const port = await findAvailablePort(8780, 8799);
  expect(port).toBeGreaterThan(8780);
});

test("throws when entire range is occupied", async () => {
  const busy = Bun.serve({ port: 8780, fetch: () => new Response("busy") });
  occupied.push(busy);
  await expect(findAvailablePort(8780, 8780)).rejects.toThrow(
    "No available port in range 8780–8780",
  );
});
```

- [ ] **Step 3: Run tests**

```bash
cd plugins/website-commenter && bun test bridge/find-port.test.ts
```

Expected: `3 tests passed`

- [ ] **Step 4: Commit**

```bash
git add plugins/website-commenter/bridge/find-port.ts plugins/website-commenter/bridge/find-port.test.ts
git commit -m "feat(website-commenter): add find-port utility with tests"
```

---

### Task 2: Rewrite bridge/server.ts — HTTP-only, state file, --port arg

**Files:**

- Modify: `plugins/website-commenter/bridge/server.ts`

- [ ] **Step 1: Replace entire contents of server.ts**

```typescript
// plugins/website-commenter/bridge/server.ts
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

// ── Port resolution ───────────────────────────────────────────────────────────

const portArgIdx = process.argv.indexOf("--port");
const port =
  portArgIdx !== -1
    ? parseInt(process.argv[portArgIdx + 1], 10)
    : await findAvailablePort();

// ── HTTP server ────────────────────────────────────────────────────────────────

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    if (req.method === "GET" && pathname === "/health")
      return json({ status: "ok", commentCount: store.length, port });

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
      return json({ ok: true, accepted: valid.length, rejected }, 201);
    }

    return fail("Not found", 404);
  },
  error: () => fail("Internal server error", 500),
});

// ── State file ─────────────────────────────────────────────────────────────────

writeFileSync(
  STATE_FILE,
  JSON.stringify({ port, pid: process.pid, started: new Date().toISOString() }),
);
console.error(`[bridge] listening on port ${port}`);
// stdout signal: skill reads this line to know the server is up
process.stdout.write(`BRIDGE_PORT=${port}\n`);

// ── Cleanup ────────────────────────────────────────────────────────────────────

const cleanup = () => {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  process.exit(0);
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
```

- [ ] **Step 2: Smoke-test the server manually**

```bash
cd plugins/website-commenter && bun bridge/server.ts --port 8789 &
sleep 0.5
curl -s http://localhost:8789/health
kill %1
```

Expected: `{"status":"ok","commentCount":0,"port":8789}`

Also verify state file is written and cleaned up:

```bash
cat /tmp/claude-wc-bridge.json   # should show {"port":8789,...} while running
# after kill: file should be gone
ls /tmp/claude-wc-bridge.json 2>&1  # should say "No such file or directory"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/website-commenter/bridge/server.ts
git commit -m "refactor(website-commenter): rewrite bridge as pure HTTP server, remove MCP"
```

---

### Task 3: Write server integration tests

**Files:**

- Create: `plugins/website-commenter/bridge/server.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// plugins/website-commenter/bridge/server.test.ts
import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";

const TEST_PORT = 8788;
const BASE = `http://localhost:${TEST_PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(
    ["bun", import.meta.dir + "/server.ts", "--port", String(TEST_PORT)],
    {
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  await Bun.sleep(500); // wait for server to bind
});

afterAll(() => {
  proc.kill();
});

beforeEach(async () => {
  // Reset store between tests
  await fetch(`${BASE}/comments`, { method: "DELETE" });
});

const validComment = {
  id: "c1",
  url: "https://example.com",
  pageTitle: "Test Page",
  timestamp: new Date().toISOString(),
  comment: "Make this blue",
  element: {
    selector: "#hero",
    outerHTML: "<div id='hero'>Hi</div>",
    tagName: "DIV",
    classNames: [],
    textContent: "Hi",
    computedStyles: {
      display: "block",
      position: "relative",
      color: "#000",
      backgroundColor: "#fff",
      fontSize: "16px",
      fontWeight: "400",
      width: "100%",
      height: "auto",
      padding: "0",
      margin: "0",
      borderRadius: "0",
      opacity: "1",
    },
  },
};

test("GET /health returns ok with port", async () => {
  const res = await fetch(`${BASE}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.commentCount).toBe(0);
  expect(body.port).toBe(TEST_PORT);
});

test("GET /comments returns empty array initially", async () => {
  const res = await fetch(`${BASE}/comments`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /comments accepts a valid comment", async () => {
  const res = await fetch(`${BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validComment),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.id).toBe("c1");
});

test("POST /comments rejects comment missing required fields", async () => {
  const res = await fetch(`${BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "x", url: "https://example.com" }),
  });
  expect(res.status).toBe(400);
});

test("GET /comments returns previously posted comment", async () => {
  await fetch(`${BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validComment),
  });
  const res = await fetch(`${BASE}/comments`);
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0].id).toBe("c1");
});

test("DELETE /comments clears the store", async () => {
  await fetch(`${BASE}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validComment),
  });
  const del = await fetch(`${BASE}/comments`, { method: "DELETE" });
  expect(del.status).toBe(200);
  expect((await del.json()).cleared).toBe(1);
  expect(await (await fetch(`${BASE}/comments`)).json()).toHaveLength(0);
});

test("POST /comments/batch accepts valid, rejects invalid entries", async () => {
  const bad = { id: "bad" }; // missing required fields
  const res = await fetch(`${BASE}/comments/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([validComment, bad]),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.accepted).toBe(1);
  expect(body.rejected).toBe(1);
});

test("OPTIONS returns CORS headers", async () => {
  const res = await fetch(`${BASE}/comments`, { method: "OPTIONS" });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});
```

- [ ] **Step 2: Run tests**

```bash
cd plugins/website-commenter && bun test bridge/server.test.ts
```

Expected: `8 tests passed`

- [ ] **Step 3: Commit**

```bash
git add plugins/website-commenter/bridge/server.test.ts
git commit -m "test(website-commenter): add HTTP bridge integration tests"
```

---

### Task 4: Create /website-commenter skill

**Files:**

- Create: `plugins/website-commenter/skills/website-commenter/SKILL.md`

- [ ] **Step 1: Create skill directory and SKILL.md**

````markdown
---
name: website-commenter
description: Start the website commenter bridge server so the Firefox extension can connect. Use when the user says "start website commenter", "start the bridge", or "connect the extension".
---

# Website Commenter — Start Bridge

## Step 1 — Check if already running

Run:

```bash
PORT=""
STATUS=""
if [ -f /tmp/claude-wc-bridge.json ]; then
  PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
  STATUS=$(curl -sf --max-time 1 "http://localhost:${PORT}/health" 2>/dev/null \
    | jq -r '.status // ""' 2>/dev/null)
fi
echo "PORT=${PORT} STATUS=${STATUS}"
```
````

If output shows `STATUS=ok`, tell the user:

> The Website Commenter bridge is already running on port **{PORT}**. Paste this into the Firefox extension if you haven't already.

Stop here. If the state file existed but the health check failed (bridge crashed), clean up and continue:

```bash
rm -f /tmp/claude-wc-bridge.json
```

## Step 2 — Start the bridge

```bash
bash ~/.claude/wc-start.sh &
sleep 0.6
```

## Step 3 — Read the port

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```

If `PORT` is empty, tell the user:

> The bridge failed to start. Make sure Bun is installed (`bun --version`) and try again.

Stop here.

## Step 4 — Display connection instructions

Tell the user:

> ✓ Website Commenter bridge is running on port **{PORT}**.
>
> **In the Firefox extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> Use `/website-comments` to fetch and apply any pending feedback.

````

- [ ] **Step 2: Verify file exists**

```bash
ls plugins/website-commenter/skills/website-commenter/
````

Expected: `SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add plugins/website-commenter/skills/website-commenter/SKILL.md
git commit -m "feat(website-commenter): add /website-commenter skill to start bridge on demand"
```

---

### Task 5: Update /website-comments skill to use dynamic port

**Files:**

- Modify: `plugins/website-commenter/skills/website-comments/SKILL.md`

- [ ] **Step 1: Replace entire SKILL.md**

````markdown
---
name: website-comments
description: Fetch and process pending DOM element comments sent from the browser extension. Use when the user says "check website comments", "apply website feedback", or asks about pending comments.
---

# Website Comments

## Step 1 — Find the bridge port

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```
````

If `PORT` is empty, tell the user:

> The Website Commenter bridge is not running. Start it first with `/website-commenter`.

Stop here.

## Step 2 — Fetch pending comments

```bash
curl -s "http://localhost:${PORT}/comments"
```

If the result is `[]`, tell the user there are no pending comments and stop.

## Step 3 — Understand each comment

For each comment you receive:

- `url` — the page where the element lives
- `comment` — what the user wants changed
- `element.selector` — CSS selector targeting the element
- `element.outerHTML` — the element's current HTML (truncated to 300 chars)
- `element.computedStyles` — live computed styles (color, font-size, etc.)
- `element.tagName`, `element.classNames`, `element.id`

## Step 4 — Apply changes

For each comment:

1. Identify the relevant source file (search by component name, selector, or class)
2. Apply the requested change
3. If ambiguous, make your best interpretation and note it

Process ALL comments before moving on.

## Step 5 — Clear processed comments

```bash
curl -s -X DELETE "http://localhost:${PORT}/comments"
```

## Step 6 — Report

Summarise what you changed, one line per comment. Flag any you couldn't action and why.

````

- [ ] **Step 2: Commit**

```bash
git add plugins/website-commenter/skills/website-comments/SKILL.md
git commit -m "refactor(website-commenter): read bridge port from state file in /website-comments"
````

---

### Task 6: Rewrite session-start.js hook

**Files:**

- Modify: `plugins/website-commenter/hooks/session-start.js`

- [ ] **Step 1: Replace entire file**

```javascript
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
```

- [ ] **Step 2: Verify syntax**

```bash
bun --eval "await import('./plugins/website-commenter/hooks/session-start.js')" 2>&1 | head -5
```

Expected: one or two harmless log lines about missing env vars, no parse errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/website-commenter/hooks/session-start.js
git commit -m "refactor(website-commenter): simplify session-start to launcher writer + status check"
```

---

### Task 7: Remove MCP dependencies

**Files:**

- Modify: `plugins/website-commenter/package.json`
- Modify: `plugins/website-commenter/bun.lock` (auto-regenerated)

- [ ] **Step 1: Update package.json**

Replace the entire file:

```json
{
  "name": "website-commenter-bridge",
  "version": "1.0.0",
  "type": "module",
  "devDependencies": {
    "bun-types": "^1.3.13"
  }
}
```

- [ ] **Step 2: Reinstall to purge MCP and zod**

```bash
cd plugins/website-commenter && bun install
```

Expected: `bun.lock` updated. Running `grep -c modelcontextprotocol bun.lock` should output `0`.

- [ ] **Step 3: Run full test suite**

```bash
cd plugins/website-commenter && bun test
```

Expected: all tests pass (find-port + server integration).

- [ ] **Step 4: Commit**

```bash
git add plugins/website-commenter/package.json plugins/website-commenter/bun.lock
git commit -m "chore(website-commenter): remove @modelcontextprotocol/sdk and zod dependencies"
```

---

### Task 8: Add bridge indicator to status line

**Files:**

- Modify: `~/.claude/statusline-command.sh`

The status line script builds its output into `$out` and prints it at the very end with:

```bash
printf "%b%s%b" "" "$out" "$RESET"
```

- [ ] **Step 1: Insert WC indicator block immediately before that printf**

Find the exact line in `~/.claude/statusline-command.sh`:

```bash
printf "%b%s%b" "" "$out" "$RESET"
collect_subagents
printf "%b" "$RESET"
```

Replace it with:

```bash
# ── Website Commenter bridge indicator ─────────────────────────────────────────
wc_indicator=""
if [ -f /tmp/claude-wc-bridge.json ]; then
  wc_port=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
  if [ -n "$wc_port" ]; then
    wc_indicator="\033[36m⬡ :${wc_port}\033[0m   "
  fi
fi
out="${wc_indicator}${out}"
# ──────────────────────────────────────────────────────────────────────────────

printf "%b%s%b" "" "$out" "$RESET"
collect_subagents
printf "%b" "$RESET"
```

- [ ] **Step 2: Verify the script parses correctly**

```bash
bash -n ~/.claude/statusline-command.sh && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Smoke-test the indicator**

```bash
echo '{"port":8785,"pid":99999,"started":"2026-04-23T10:00:00.000Z"}' > /tmp/claude-wc-bridge.json
echo '{}' | bash ~/.claude/statusline-command.sh | cat
rm /tmp/claude-wc-bridge.json
```

Expected: output begins with `⬡ :8785` in cyan, followed by the normal model/ctx line.

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/statusline-command.sh
git commit -m "feat(website-commenter): add ⬡ :PORT bridge indicator to status line"
```

---

### Task 9: Generate browser extension edit prompt

This task produces a detailed prompt you can paste into a new Claude session alongside the extension's source code to implement the port field + health-check UI.

- [ ] **Step 1: Locate the extension source**

Identify the Firefox extension repository. It should contain at minimum:

- `manifest.json`
- A popup HTML/JS (`popup.html` / `popup.js` or equivalent)
- A background/service-worker script
- Content script(s) that capture DOM element clicks

- [ ] **Step 2: Open the extension in a new Claude session and paste this prompt**

---

**Prompt to paste:**

````
I have a Firefox browser extension that sends DOM element annotations to a local
HTTP bridge server. I need you to modify the extension to support a configurable
port, health-checking, and a connection status indicator.

## Current behaviour
The extension currently hard-codes port 8789 when POSTing comments to
`http://localhost:8789/comments`.

## Required changes

### 1. Port input field in the popup
- Add a numeric input field (label: "Bridge port") to the popup UI, defaulting to 8789.
- Persist the entered port using `browser.storage.local` (key: `bridgePort`).
- Load the saved port on popup open and pre-fill the field.

### 2. Connect button + status indicator in the popup
- Add a "Connect" button next to the port field.
- When clicked, POST to `http://localhost:{port}/health` (GET request actually) and:
  - If response is `{ "status": "ok" }` → show a green dot + "Connected on :{port}"
  - If request fails or status ≠ ok → show a red dot + "Not connected"
- Save the confirmed port to `browser.storage.local` only on successful connection.

### 3. Background health poll
- In the background/service-worker script, poll `GET http://localhost:{port}/health`
  every 30 seconds using the stored `bridgePort`.
- If the health check fails, update a badge or storage flag so the popup can show
  "Disconnected" next time it opens.

### 4. Use stored port when sending comments
- Replace all hard-coded `8789` references with the stored `bridgePort` value
  (read from `browser.storage.local` before every POST).

## Bridge API reference
The bridge server exposes:
- `GET /health` → `{ "status": "ok", "commentCount": number, "port": number }`
- `POST /comments` → body: WebsiteComment (see below) → `{ "ok": true, "id": string }`
- `GET /comments` → WebsiteComment[]
- `DELETE /comments` → `{ "cleared": number }`

### WebsiteComment shape
```json
{
  "id": "string",
  "url": "string",
  "pageTitle": "string",
  "timestamp": "ISO8601 string",
  "comment": "string",
  "element": {
    "selector": "string",
    "outerHTML": "string",
    "tagName": "string",
    "id": "string (optional)",
    "classNames": ["string"],
    "textContent": "string",
    "computedStyles": {
      "display": "string",
      "position": "string",
      "color": "string",
      "backgroundColor": "string",
      "fontSize": "string",
      "fontWeight": "string",
      "width": "string",
      "height": "string",
      "padding": "string",
      "margin": "string",
      "borderRadius": "string",
      "opacity": "string"
    }
  }
}
````

Please read all extension files first, then implement these changes. The popup UI
should look clean — a small port field + connect button row at the top, with the
status dot inline.

````

---

*After pasting this prompt, share the extension's source files in the same session.*

- [ ] **Step 3: Commit this plan update (no code change, just documentation)**

```bash
git add docs/superpowers/plans/2026-04-23-website-commenter-session-bridge.md
git commit -m "docs: add browser extension edit prompt to website-commenter plan (Task 9)"
````

---

## Self-Review

**Spec coverage:**

- ✓ Explicit start via skill — Task 4
- ✓ Dynamic port selection (8780–8799) — Task 1
- ✓ User prompted to paste port into extension — Task 4, Step 4
- ✓ Extension health check on connect + every 30s — Task 9 prompt (browser-side spec)
- ✓ Show bridge running inside Claude Code — Task 8 (status bar) + session-start context
- ✓ Per-session isolation: no shared port conflicts — each `/website-commenter` invocation finds its own free port
- ✓ MCP code removed — Tasks 2 and 7

**Known limitation (by design):** Running `/website-commenter` in a second session while a first is active starts a second bridge on a different port. The state file is overwritten with the new port, so `/website-comments` in the first session would then target the wrong port. For single-session personal use this is not an issue.
