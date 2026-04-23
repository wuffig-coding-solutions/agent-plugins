import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";

const TEST_PORT = 8788;
const BASE = `http://localhost:${TEST_PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

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
