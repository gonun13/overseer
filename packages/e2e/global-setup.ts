// `docker compose run --rm e2e` starts its dependencies (web, server, deps)
// alongside it rather than waiting for them — Vite and the server both take a
// few seconds to bind after that. Polling here means tests fail on their own
// assertions instead of on a first-navigation connection-refused race.
async function waitUntilReachable(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      // Status matters, not just that something answered: Vite serves its
      // "Blocked request. This host is not allowed" page with a 403, and a bare
      // reachability check waves that through so every test then fails on an
      // empty document instead of here, where the cause is named.
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `e2e: ${url} never became reachable within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://web:5173";
  await waitUntilReachable(baseURL, 60_000);
}
