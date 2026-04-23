// plugins/website-commenter/bridge/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findAvailablePort } from "./find-port";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

export const STATE_FILE = `/tmp/claude-wc-bridge-${process.pid}.json`;

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
      if (!httpServer) {
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
      if (httpServer) {
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
          count: comments.length,
          comment_ids: comments.map((c) => c.id).join(","),
        },
      },
    });
  } catch (err) {
    console.error("[bridge] batch channel push failed:", err);
  }
}

// ── Port resolution ───────────────────────────────────────────────────────────

const portArgIdx = process.argv.indexOf("--port");
const portArg =
  portArgIdx !== -1 ? parseInt(process.argv[portArgIdx + 1], 10) : NaN;
let port =
  !isNaN(portArg) && portArg > 0 && portArg < 65536
    ? portArg
    : await findAvailablePort();

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
        pushBatchChannelNotification(valid).catch(() => {});
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
        });

      return fail("Not found", 404);
    },
    error: () => fail("Internal server error", 500),
  });
  port = listenPort;
  console.error(`[bridge] listening on port ${port}`);
}

function stopHttpServer(): void {
  if (httpServer) {
    httpServer.stop(true);
    httpServer = null;
    console.error("[bridge] HTTP server stopped");
  }
  if (!skipStateFile && existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

startHttpServer(port);

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

// ── Cleanup ────────────────────────────────────────────────────────────────────

const cleanup = () => {
  if (!skipStateFile && existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  process.exit(0);
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

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
