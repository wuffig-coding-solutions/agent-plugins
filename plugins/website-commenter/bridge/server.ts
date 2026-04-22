import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Inlined types (mirrors src/shared/types.ts in the extension repo) ────────

interface ComputedStyles {
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
}

interface ElementData {
  selector: string;
  outerHTML: string;
  tagName: string;
  id?: string;
  classNames: string[];
  textContent: string;
  computedStyles: ComputedStyles;
}

interface WebsiteComment {
  id: string;
  url: string;
  pageTitle: string;
  timestamp: string;
  comment: string;
  element: ElementData;
}

interface HealthResponse {
  status: "ok";
  commentCount: number;
  channelActive: boolean;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const pendingComments: WebsiteComment[] = [];

// ─── Channel active tracking ──────────────────────────────────────────────────

let channelActive = false;

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "website-comments", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `Website comments arrive as channel events from the browser extension.
Each event contains: the user's comment text about a DOM element, the page URL,
CSS selector targeting the element, truncated outer HTML, and computed styles.
Use get_website_comments to poll for comments if channel is not active.
Use clear_website_comments after processing to acknowledge receipt.`,
  },
);

// ─── Tool: get_website_comments ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_website_comments",
        description:
          "Returns all pending website comments submitted by the browser extension. " +
          "Use this to poll for comments when the channel is not active.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description:
                "Maximum number of comments to return (default: all)",
            },
          },
          required: [],
        },
      },
      {
        name: "clear_website_comments",
        description:
          "Clears pending website comments from the store. " +
          "Call this after processing comments to acknowledge receipt.",
        inputSchema: {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific comment IDs to clear. Omit to clear all.",
            },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_website_comments") {
    const limit = typeof args?.limit === "number" ? args.limit : undefined;
    const comments =
      limit !== undefined
        ? pendingComments.slice(0, limit)
        : pendingComments.slice();

    if (comments.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No pending website comments.",
          },
        ],
      };
    }

    const formatted = comments
      .map((c, i) => {
        return [
          `--- Comment ${i + 1} (id: ${c.id}) ---`,
          `URL: ${c.url}`,
          `Page: ${c.pageTitle}`,
          `Timestamp: ${c.timestamp}`,
          `Element: <${c.element.tagName}> (selector: ${c.element.selector})`,
          `Comment: ${c.comment}`,
          `HTML: ${c.element.outerHTML.substring(0, 300)}`,
        ].join("\n");
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `${comments.length} pending comment(s):\n\n${formatted}`,
        },
      ],
    };
  }

  if (name === "clear_website_comments") {
    const ids = Array.isArray(args?.ids) ? (args.ids as string[]) : undefined;

    if (ids !== undefined) {
      const idSet = new Set(ids);
      const before = pendingComments.length;
      for (let i = pendingComments.length - 1; i >= 0; i--) {
        if (idSet.has(pendingComments[i].id)) {
          pendingComments.splice(i, 1);
        }
      }
      const cleared = before - pendingComments.length;
      return {
        content: [
          {
            type: "text",
            text: `Cleared ${cleared} comment(s). ${pendingComments.length} remaining.`,
          },
        ],
      };
    } else {
      const count = pendingComments.length;
      pendingComments.splice(0, pendingComments.length);
      return {
        content: [
          {
            type: "text",
            text: `Cleared all ${count} comment(s).`,
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// ─── Channel push helpers ─────────────────────────────────────────────────────

async function pushChannelNotification(comment: WebsiteComment): Promise<void> {
  if (!channelActive) return;
  try {
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content: `Comment on [${comment.element.tagName}] at ${comment.url}:\n${comment.comment}`,
        meta: {
          url: comment.url,
          page_title: comment.pageTitle,
          selector: comment.element.selector,
          element_tag: comment.element.tagName,
          element_html: comment.element.outerHTML.substring(0, 300),
          comment_id: comment.id,
        },
      },
    });
  } catch (err) {
    console.error("[bridge] Failed to push channel notification:", err);
  }
}

async function pushBatchChannelNotification(
  comments: WebsiteComment[],
): Promise<void> {
  if (!channelActive || comments.length === 0) return;
  const summary = comments
    .map((c) => `• [${c.element.tagName}] ${c.comment} (${c.url})`)
    .join("\n");
  try {
    await server.notification({
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
    console.error("[bridge] Failed to push batch channel notification:", err);
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidComment(obj: unknown): obj is WebsiteComment {
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
  ) {
    return false;
  }
  const el = c.element as Record<string, unknown>;
  if (
    typeof el.selector !== "string" ||
    typeof el.outerHTML !== "string" ||
    typeof el.tagName !== "string" ||
    typeof el.textContent !== "string" ||
    !Array.isArray(el.classNames)
  ) {
    return false;
  }
  return true;
}

// ─── HTTP Server helpers ──────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const HTTP_PORT = 8789;

Bun.serve({
  port: HTTP_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /health
    if (req.method === "GET" && pathname === "/health") {
      const body: HealthResponse = {
        status: "ok",
        commentCount: pendingComments.length,
        channelActive,
      };
      return jsonResponse(body);
    }

    // GET /comments — debug listing
    if (req.method === "GET" && pathname === "/comments") {
      return jsonResponse(pendingComments);
    }

    // DELETE /comments — clear all
    if (req.method === "DELETE" && pathname === "/comments") {
      const count = pendingComments.length;
      pendingComments.splice(0, pendingComments.length);
      return jsonResponse({ cleared: count });
    }

    // POST /comments — single comment
    if (req.method === "POST" && pathname === "/comments") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      if (!isValidComment(body)) {
        return errorResponse("Invalid comment shape — missing required fields");
      }

      pendingComments.push(body);
      console.error(`[bridge] Received comment id=${body.id} url=${body.url}`);

      // Fire-and-forget channel push
      pushChannelNotification(body).catch(() => {});

      return jsonResponse({ ok: true, id: body.id }, 201);
    }

    // POST /comments/batch — array of comments
    if (req.method === "POST" && pathname === "/comments/batch") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      if (!Array.isArray(body)) {
        return errorResponse("Expected an array of comments");
      }

      const valid: WebsiteComment[] = [];
      const invalid: number[] = [];

      for (let i = 0; i < body.length; i++) {
        if (isValidComment(body[i])) {
          valid.push(body[i] as WebsiteComment);
        } else {
          invalid.push(i);
        }
      }

      if (invalid.length > 0 && valid.length === 0) {
        return errorResponse(`All ${body.length} comments failed validation`);
      }

      for (const comment of valid) {
        pendingComments.push(comment);
      }

      console.error(
        `[bridge] Received batch of ${valid.length} comment(s) (${invalid.length} rejected)`,
      );

      // Push consolidated channel notification
      pushBatchChannelNotification(valid).catch(() => {});

      return jsonResponse(
        {
          ok: true,
          accepted: valid.length,
          rejected: invalid.length,
          rejectedIndices: invalid,
        },
        201,
      );
    }

    return errorResponse("Not found", 404);
  },
  error(err) {
    console.error("[bridge] HTTP server error:", err);
    return errorResponse("Internal server error", 500);
  },
});

console.error(`[bridge] HTTP server listening on port ${HTTP_PORT}`);

// ─── MCP transport ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();

transport.onclose = () => {
  channelActive = false;
  console.error("[bridge] MCP transport closed");
};

transport.onerror = (err) => {
  console.error("[bridge] MCP transport error:", err);
};

server.oninitialized = () => {
  channelActive = true;
  console.error("[bridge] MCP initialized — channel active");
};

await server.connect(transport);
console.error("[bridge] MCP server connected via stdio");
