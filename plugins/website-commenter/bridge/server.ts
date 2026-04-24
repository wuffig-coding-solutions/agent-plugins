// plugins/website-commenter/bridge/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findAvailablePort } from "./find-port";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";

export const STATE_FILE = `/tmp/claude-wc-bridge-${process.pid}.json`;

// Shared across sessions: lets a new session adopt a bridge that outlived the previous MCP transport.
export const PERSISTENT_STATE_FILE = "/tmp/claude-wc-bridge-persistent.json";

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
        name: "get_bridge_port",
        description:
          "Returns the HTTP port this bridge is listening on. " +
          "Use this to tell the user which port to enter in the browser extension.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
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
      {
        name: "disconnect_bridge",
        description:
          "Stops the HTTP bridge server. The browser extension will lose connectivity. " +
          "The MCP server stays alive so you can call connect_bridge to restart it.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "connect_bridge",
        description:
          "Starts (or restarts) the HTTP bridge server on a new available port. " +
          "Returns the new port number. Use after disconnect_bridge to reconnect.",
        inputSchema: {
          type: "object",
          properties: {
            port: {
              type: "number",
              description:
                "Specific port to use. Omit to auto-select an available port.",
            },
          },
          required: [],
        },
      },
    ],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "get_bridge_port") {
      if (!httpServer && !isAdopted) {
        return {
          content: [
            {
              type: "text",
              text: "Bridge is stopped. Call connect_bridge to start it.",
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: String(port) }],
      };
    }

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

    if (name === "disconnect_bridge") {
      if (!httpServer && !isAdopted) {
        return {
          content: [{ type: "text", text: "Bridge is not running." }],
          isError: true,
        };
      }

      if (isAdopted) {
        // The HTTP server lives in an orphan process — kill it via the stored PID.
        try {
          const state = JSON.parse(
            readFileSync(PERSISTENT_STATE_FILE, "utf8") as string,
          ) as { pid?: number };
          if (typeof state.pid === "number") {
            process.kill(state.pid, "SIGKILL");
          }
        } catch {
          // orphan may have already exited
        }
        isAdopted = false;
        port = 0;
        if (!skipStateFile) {
          try {
            if (existsSync(PERSISTENT_STATE_FILE))
              unlinkSync(PERSISTENT_STATE_FILE);
          } catch {}
          try {
            if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
          } catch {}
        }
        return {
          content: [
            {
              type: "text",
              text: "Bridge stopped (orphan server terminated). Use connect_bridge to restart.",
            },
          ],
        };
      }

      stopHttpServer();
      return {
        content: [
          {
            type: "text",
            text: "Bridge HTTP server stopped. Use connect_bridge to restart.",
          },
        ],
      };
    }

    if (name === "connect_bridge") {
      if (httpServer || isAdopted) {
        return {
          content: [
            { type: "text", text: `Bridge already running on port ${port}.` },
          ],
        };
      }
      const requestedPort =
        typeof args?.port === "number" && args.port > 0 && args.port < 65536
          ? args.port
          : await findAvailablePort();
      startHttpServer(requestedPort);
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
      return {
        content: [{ type: "text", text: `Bridge started on port ${port}.` }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });
}

// ── Channel push helper ───────────────────────────────────────────────────────

let lastNotificationResult: {
  timestamp: string;
  status: "sent" | "skipped" | "error";
  reason?: string;
  commentId?: string;
} | null = null;

export function getLastNotificationResult() {
  return lastNotificationResult;
}

async function pushChannelNotification(comment: WebsiteComment): Promise<void> {
  if (!mcpServer) {
    lastNotificationResult = {
      timestamp: new Date().toISOString(),
      status: "skipped",
      reason: "mcpServer is null",
      commentId: comment.id,
    };
    console.error("[bridge] channel push skipped: mcpServer is null");
    return;
  }
  if (!channelActive) {
    lastNotificationResult = {
      timestamp: new Date().toISOString(),
      status: "skipped",
      reason: "channelActive is false",
      commentId: comment.id,
    };
    console.error("[bridge] channel push skipped: channelActive is false");
    return;
  }
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
    lastNotificationResult = {
      timestamp: new Date().toISOString(),
      status: "sent",
      commentId: comment.id,
    };
    console.error(
      `[bridge] channel notification sent for comment ${comment.id}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastNotificationResult = {
      timestamp: new Date().toISOString(),
      status: "error",
      reason: msg,
      commentId: comment.id,
    };
    console.error("[bridge] channel push failed:", err);
  }
}

async function pushBatchChannelNotification(
  comments: WebsiteComment[],
): Promise<void> {
  if (!mcpServer || !channelActive || comments.length === 0) return;
  const summary = comments
    .map((c) => `• "${c.comment}" on <${c.element.tagName}> at ${c.url}`)
    .join("\n");
  try {
    await mcpServer.notification({
      method: "notifications/claude/channel",
      params: {
        content: `${comments.length} new website comment(s):\n${summary}`,
        meta: {
          count: String(comments.length),
          comment_ids: comments.map((c) => c.id).join(","),
        },
      },
    });
    console.error(
      `[bridge] batch channel notification sent for ${comments.length} comment(s)`,
    );
  } catch (err) {
    console.error("[bridge] batch channel push failed:", err);
  }
}

// ── Port state ────────────────────────────────────────────────────────────────
// Port is 0 until connect_bridge is called. The HTTP server does NOT auto-start.

let port = 0;

// True when this bridge session adopted an HTTP server started by a prior session.
// The server runs in a separate (orphan) process; we just know its port.
let isAdopted = false;

// ── State file flag ──────────────────────────────────────────────────────────

const skipStateFile = process.env.WC_NO_STATE_FILE === "1";

// ── HTTP server ────────────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof Bun.serve> | null = null;

function startHttpServer(listenPort: number): void {
  httpServer = Bun.serve({
    port: listenPort,
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
        await pushChannelNotification(body);
        return json(
          { ok: true, id: body.id, notification: lastNotificationResult },
          201,
        );
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
        // Await the notification so it is guaranteed to be sent before the
        // response is returned. Fire-and-forget was unreliable in Bun's
        // request lifecycle.
        await pushBatchChannelNotification(valid);
        return json({ ok: true, accepted: valid.length, rejected }, 201);
      }

      if (req.method === "GET" && pathname === "/debug")
        return json({
          channelActive,
          mcpServerExists: mcpServer !== null,
          skipMcp,
          lastNotification: lastNotificationResult,
          storeCount: store.length,
          pid: process.pid,
          isAdopted,
        });

      return fail("Not found", 404);
    },
    error: () => fail("Internal server error", 500),
  });
  port = listenPort;
  console.error(`[bridge] listening on port ${port}`);

  // Write persistent state so a future session can adopt this server if we
  // outlive the current MCP transport (i.e. become an orphan on SIGTERM).
  if (!skipStateFile) {
    writeFileSync(
      PERSISTENT_STATE_FILE,
      JSON.stringify({
        port,
        pid: process.pid,
        started: new Date().toISOString(),
      }),
    );
  }
}

function stopHttpServer(): void {
  if (httpServer) {
    httpServer.stop(true);
    httpServer = null;
    console.error("[bridge] HTTP server stopped");
  }
  port = 0;
  isAdopted = false;
  if (!skipStateFile) {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
    if (existsSync(PERSISTENT_STATE_FILE)) unlinkSync(PERSISTENT_STATE_FILE);
  }
}

// ── Test mode auto-start ──────────────────────────────────────────────────────
// When WC_NO_MCP=1 (test environment) and --port N is passed, start the HTTP
// server immediately so tests can talk to it without calling connect_bridge.

if (skipMcp) {
  const portArgIdx = process.argv.indexOf("--port");
  if (portArgIdx !== -1) {
    const testPort = parseInt(process.argv[portArgIdx + 1], 10);
    if (!isNaN(testPort) && testPort > 0) {
      startHttpServer(testPort);
    }
  }
}

// HTTP server is NOT started automatically in normal mode.
// Call connect_bridge (via /wc-connect) to start it.

// ── Cleanup ────────────────────────────────────────────────────────────────────

const cleanup = (signal: "SIGTERM" | "SIGINT") => {
  // Always remove the per-PID state file so the statusline clears immediately.
  if (!skipStateFile && existsSync(STATE_FILE)) unlinkSync(STATE_FILE);

  if (signal === "SIGTERM" && httpServer) {
    // The MCP transport is closing but WE own a running HTTP server.
    // Keep the process alive as an orphan so the extension stays connected.
    // The persistent state file is already written — the next Claude Code
    // session will adopt this server automatically.
    channelActive = false;
    console.error(
      `[bridge] SIGTERM: MCP session ended, HTTP server persisting on port ${port} (PID ${process.pid})`,
    );
    return; // Do NOT call process.exit — let Bun's event loop keep the server running.
  }

  // SIGINT (Ctrl-C), or SIGTERM with no HTTP server running — full shutdown.
  if (httpServer) {
    httpServer.stop(true);
    httpServer = null;
  }
  if (!skipStateFile && existsSync(PERSISTENT_STATE_FILE)) {
    unlinkSync(PERSISTENT_STATE_FILE);
  }
  process.exit(0);
};

process.on("SIGTERM", () => cleanup("SIGTERM"));
process.on("SIGINT", () => cleanup("SIGINT"));

// ── Startup: adopt an existing orphan HTTP server ─────────────────────────────
// If a previous bridge left a persistent state file, try to health-check the
// server it left behind. If it is still alive, adopt its port so this session
// can report the correct port without starting a new server.

if (!skipMcp && !skipStateFile) {
  try {
    const raw = readFileSync(PERSISTENT_STATE_FILE, "utf8");
    const state = JSON.parse(raw) as { port?: number; pid?: number };
    if (typeof state.port === "number" && state.port > 0) {
      const res = await fetch(`http://localhost:${state.port}/health`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null);
      if (res && res.ok) {
        port = state.port;
        isAdopted = true;
        // Write a per-PID state file so the statusline shows the adopted port.
        writeFileSync(
          STATE_FILE,
          JSON.stringify({
            port,
            pid: process.pid,
            started: new Date().toISOString(),
          }),
        );
        console.error(
          `[bridge] adopted existing HTTP server on port ${port} (orphan PID ${state.pid ?? "?"})`,
        );
      } else {
        // Stale persistent state — the old server is gone.
        unlinkSync(PERSISTENT_STATE_FILE);
        console.error("[bridge] stale persistent state file removed");
      }
    }
  } catch {
    // No state file, parse error, or FS error — normal fresh start.
  }
}

// ── MCP transport (after HTTP is ready) ───────────────────────────────────────

if (!skipMcp && mcpServer) {
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    channelActive = false;
    console.error("[bridge] MCP transport closed");
  };
  transport.onerror = (err) => {
    channelActive = false;
    console.error("[bridge] MCP transport error:", err);
  };
  mcpServer.oninitialized = () => {
    channelActive = true;
    console.error("[bridge] MCP initialized — channel active");
  };
  await mcpServer.connect(transport);
  console.error("[bridge] MCP server connected via stdio");
}
