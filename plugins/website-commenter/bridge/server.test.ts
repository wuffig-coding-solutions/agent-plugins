import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";

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
