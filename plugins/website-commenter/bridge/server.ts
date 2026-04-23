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
// stdout signal: skill reads this to know the server is up
process.stdout.write(`BRIDGE_PORT=${port}\n`);

// ── Cleanup ────────────────────────────────────────────────────────────────────

const cleanup = () => {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  process.exit(0);
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
