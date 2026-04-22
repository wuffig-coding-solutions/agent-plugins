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
