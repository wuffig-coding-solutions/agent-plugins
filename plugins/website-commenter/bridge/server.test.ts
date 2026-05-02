import {
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  describe,
} from "bun:test";
import fs from "node:fs";
import { syncFromOrphan } from "./server";

const TEST_PORT = 8788;
const BASE = `http://localhost:${TEST_PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

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

afterAll(() => {
  proc.kill();
});

beforeEach(async () => {
  // Reset store between tests
  await fetch(`${BASE}/comment`, { method: "DELETE" });
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

test("GET /comment returns empty array initially", async () => {
  const res = await fetch(`${BASE}/comment`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /comment accepts a valid comment", async () => {
  const res = await fetch(`${BASE}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "send-comment", comment: validComment }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.id).toBe("c1");
});

test("POST /comment rejects wrong type field", async () => {
  const res = await fetch(`${BASE}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "wrong", comment: validComment }),
  });
  expect(res.status).toBe(400);
});

test("POST /comment rejects comment missing required fields", async () => {
  const res = await fetch(`${BASE}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "send-comment",
      comment: { id: "x", url: "https://example.com" },
    }),
  });
  expect(res.status).toBe(400);
});

test("GET /comment returns previously posted comment", async () => {
  await fetch(`${BASE}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "send-comment", comment: validComment }),
  });
  const res = await fetch(`${BASE}/comment`);
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0].id).toBe("c1");
});

test("DELETE /comment clears the store", async () => {
  await fetch(`${BASE}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "send-comment", comment: validComment }),
  });
  const del = await fetch(`${BASE}/comment`, { method: "DELETE" });
  expect(del.status).toBe(200);
  expect((await del.json()).cleared).toBe(1);
  expect(await (await fetch(`${BASE}/comment`)).json()).toHaveLength(0);
});

test("POST /comment-batch accepts valid, rejects invalid entries", async () => {
  const bad = { id: "bad" }; // missing required fields
  const res = await fetch(`${BASE}/comment-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "send-batch", comments: [validComment, bad] }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.accepted).toBe(1);
  expect(body.rejected).toBe(1);
});

test("POST /comment-batch rejects wrong type field", async () => {
  const res = await fetch(`${BASE}/comment-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "wrong", comments: [validComment] }),
  });
  expect(res.status).toBe(400);
});

test("POST /comment-batch rejects missing comments array", async () => {
  const res = await fetch(`${BASE}/comment-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "send-batch" }),
  });
  expect(res.status).toBe(400);
});

test("OPTIONS returns CORS headers", async () => {
  const res = await fetch(`${BASE}/comment`, { method: "OPTIONS" });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("POST /claim-session updates channelActive in /health", async () => {
  // Server starts with channelActive:false (WC_NO_MCP=1)
  const before = await (await fetch(`${BASE}/health`)).json();
  expect(before.channelActive).toBe(false);

  // Claim session as active
  const claim = await fetch(`${BASE}/claim-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  expect(claim.status).toBe(200);
  expect((await claim.json()).ok).toBe(true);
  expect((await (await fetch(`${BASE}/health`)).json()).channelActive).toBe(
    true,
  );

  // Release session
  await fetch(`${BASE}/claim-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false }),
  });
  expect((await (await fetch(`${BASE}/health`)).json()).channelActive).toBe(
    false,
  );
});

// ── Hook-driven busy state tests ──────────────────────────────────────────────
// The STATE_FILE is keyed by the server's process.ppid.
// Since the server is a child of the test process, server.ppid === test process.pid.
// So writing to `/tmp/claude-wc-bridge-${process.pid}.json` is what the server reads.
//
// These tests verify isClaudeBusy() behavior via the GET /health endpoint's
// `hookBusy` and `flagAge` fields, which reflect state-file reads directly.
// Backlog tests are omitted because the backlog condition requires channelActive=true,
// which is never true in test mode (WC_NO_MCP=1).

const HOOK_PORT = 8789;
const HOOK_BASE = `http://localhost:${HOOK_PORT}`;
const HOOK_STATE_FILE = `/tmp/claude-wc-bridge-${process.pid}.json`;
let hookProc: ReturnType<typeof Bun.spawn>;

describe("hook-driven busy state (isClaudeBusy via /health)", () => {
  beforeAll(async () => {
    // Kill any stale process already on this port (orphan from a prior test run).
    const staleDebug = await fetch(`${HOOK_BASE}/debug`, {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (staleDebug?.ok) {
      const staleInfo = (await staleDebug.json()) as { pid?: number };
      if (typeof staleInfo.pid === "number") process.kill(staleInfo.pid, 9);
      await Bun.sleep(100);
    }
    hookProc = Bun.spawn(
      ["bun", import.meta.dir + "/server.ts", "--port", String(HOOK_PORT)],
      {
        stdio: ["ignore", "ignore", "ignore"],
        // Omit WC_NO_STATE_FILE so the server reads HOOK_STATE_FILE
        env: { ...process.env, WC_NO_MCP: "1" },
      },
    );
    await Bun.sleep(500);
    // Verify the server we spawned is actually serving on HOOK_PORT.
    const debugRes = await fetch(`${HOOK_BASE}/debug`).catch(() => null);
    if (!debugRes || !debugRes.ok)
      throw new Error(`Hook server failed to start on port ${HOOK_PORT}`);
    const debug = (await debugRes.json()) as { pid?: number };
    if (debug.pid !== hookProc.pid) {
      hookProc.kill(9);
      throw new Error(
        `Port ${HOOK_PORT} still occupied after killing stale server (pid ${debug.pid}, expected ${hookProc.pid}).`,
      );
    }
  });

  afterAll(() => {
    hookProc.kill(9); // SIGKILL so the server exits immediately instead of becoming an orphan
    try {
      fs.unlinkSync(HOOK_STATE_FILE);
    } catch {}
    try {
      fs.unlinkSync(HOOK_STATE_FILE + ".tmp");
    } catch {}
  });

  beforeEach(async () => {
    await fetch(`${HOOK_BASE}/comment`, { method: "DELETE" });
    try {
      fs.unlinkSync(HOOK_STATE_FILE);
    } catch {}
  });

  test("busy:true in state file → hookBusy is true", async () => {
    fs.writeFileSync(
      HOOK_STATE_FILE,
      JSON.stringify({ busy: true, busyTs: new Date().toISOString() }),
    );
    const res = await fetch(`${HOOK_BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookBusy).toBe(true);
  });

  test("busy:false in state file → hookBusy is false", async () => {
    fs.writeFileSync(
      HOOK_STATE_FILE,
      JSON.stringify({ busy: false, busyTs: new Date().toISOString() }),
    );
    const res = await fetch(`${HOOK_BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookBusy).toBe(false);
  });

  test("stale busyTs (>5 min old) with busy:true → hookBusy is false", async () => {
    fs.writeFileSync(
      HOOK_STATE_FILE,
      JSON.stringify({
        busy: true,
        busyTs: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      }),
    );
    const res = await fetch(`${HOOK_BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookBusy).toBe(false);
  });

  test("no state file → hookBusy is null", async () => {
    // beforeEach already removed the file
    const res = await fetch(`${HOOK_BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookBusy).toBeNull();
  });

  test("/health includes flagAge field (number when file exists, null when not)", async () => {
    // No file → flagAge should be null
    const resNoFile = await fetch(`${HOOK_BASE}/health`);
    const bodyNoFile = await resNoFile.json();
    expect(bodyNoFile.flagAge).toBeNull();

    // Write a fresh state file → flagAge should be a small non-negative number
    fs.writeFileSync(
      HOOK_STATE_FILE,
      JSON.stringify({ busy: true, busyTs: new Date().toISOString() }),
    );
    const resWithFile = await fetch(`${HOOK_BASE}/health`);
    const bodyWithFile = await resWithFile.json();
    expect(typeof bodyWithFile.flagAge).toBe("number");
    expect(bodyWithFile.flagAge).toBeGreaterThanOrEqual(0);
  });
});

// ── Bug 1: persistent state file marks non-MCP servers ───────────────────────
// A server started with WC_NO_MCP=1 must write isMcp:false to the persistent
// state file so that a new real MCP session can skip adopting it as an orphan.

const PERSISTENT_STATE_PATH = "/tmp/claude-wc-bridge-persistent.json";
const NON_MCP_PORT = 8790;
const NON_MCP_BASE = `http://localhost:${NON_MCP_PORT}`;
let nonMcpProc: ReturnType<typeof Bun.spawn>;

describe("persistent state file marks non-MCP servers", () => {
  beforeAll(async () => {
    // Kill any stale process already on this port (orphan from a prior test run).
    const stale = await fetch(`http://localhost:${NON_MCP_PORT}/debug`, {
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (stale?.ok) {
      const debug = (await stale.json()) as { pid?: number };
      if (typeof debug.pid === "number") process.kill(debug.pid, 9);
      await Bun.sleep(100);
    }
    try {
      fs.unlinkSync(PERSISTENT_STATE_PATH);
    } catch {}
    nonMcpProc = Bun.spawn(
      ["bun", import.meta.dir + "/server.ts", "--port", String(NON_MCP_PORT)],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, WC_NO_MCP: "1" }, // no WC_NO_STATE_FILE — must write persistent file
      },
    );
    await Bun.sleep(500);
  });

  afterAll(() => {
    nonMcpProc.kill(9); // SIGKILL so the server exits immediately instead of becoming an orphan
    try {
      fs.unlinkSync(PERSISTENT_STATE_PATH);
    } catch {}
  });

  test("persistent state file has isMcp:false for a WC_NO_MCP=1 server", () => {
    const raw = JSON.parse(fs.readFileSync(PERSISTENT_STATE_PATH, "utf8"));
    expect(raw.isMcp).toBe(false);
  });
});

// ── Bug 2: syncFromOrphan fetches and deduplicates comments ──────────────────
// Uses the main TEST_PORT server (started in the top-level beforeAll) as a
// stand-in for an orphan HTTP server.

describe("syncFromOrphan", () => {
  beforeEach(async () => {
    await fetch(`${BASE}/comment`, { method: "DELETE" });
  });

  test("returns new comments and tracks their IDs in seenIds", async () => {
    await fetch(`${BASE}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "send-comment", comment: validComment }),
    });

    const seenIds = new Set<string>();
    const newComments = await syncFromOrphan(BASE, seenIds);

    expect(newComments).toHaveLength(1);
    expect(newComments[0].id).toBe(validComment.id);
    expect(seenIds.has(validComment.id)).toBe(true);
  });

  test("does not return already-seen comments", async () => {
    await fetch(`${BASE}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "send-comment", comment: validComment }),
    });

    const seenIds = new Set<string>([validComment.id]);
    const newComments = await syncFromOrphan(BASE, seenIds);

    expect(newComments).toHaveLength(0);
  });

  test("returns empty array when orphan server is unreachable", async () => {
    const seenIds = new Set<string>();
    const newComments = await syncFromOrphan("http://localhost:9999", seenIds);
    expect(newComments).toHaveLength(0);
  });
});
