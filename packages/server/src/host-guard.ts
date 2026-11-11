/**
 * Which `Host` headers the server answers (spec/architecture.md §6).
 *
 * The Origin check on the WebSocket upgrade compares Origin's host with the
 * Host header, which a DNS-rebinding page passes: `evil.example` re-resolved
 * to 127.0.0.1 sends `Origin: http://evil.example:3000` and
 * `Host: evil.example:3000`, and they match. What it cannot do is make the
 * browser send a loopback name as Host, so the server only answers to those.
 *
 * Only the name is checked, not the port: the port the browser sees is
 * compose's mapping (3000, 3001, 5173 through Vite's proxy), not the one this
 * process listens on, and a rebinding attacker cannot choose the name.
 */
const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Extra names, comma-separated, from `OVERSEER_ALLOWED_HOSTS`. The dev stack
 * sets `web`: the e2e browser reaches the app as `web:5173` and Vite's proxy
 * passes that Host through unchanged.
 */
export function allowedHostnames(
  extra: string | undefined = process.env.OVERSEER_ALLOWED_HOSTS,
): ReadonlySet<string> {
  const names = (extra ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return new Set([...LOOPBACK_NAMES, ...names]);
}

export function isAllowedHost(
  host: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  // Anything beyond host[:port] — userinfo, a path — is not a Host header,
  // and would let the URL parser below pick a different hostname.
  if (!host || /[@/\\?#\s]/.test(host)) return false;
  try {
    return allowed.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
