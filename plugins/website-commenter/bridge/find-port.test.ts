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
