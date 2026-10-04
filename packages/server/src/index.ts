import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { SESSION_MAX_TEXT_CHARS } from "@overseer/protocol";
import { attachWebSocketServer } from "./ws.js";
import { startTranscriptMonitor } from "./transcript-monitor.js";
import { startUsageRefresh } from "./usage-refresh.js";
import { startWorkspaceMonitor } from "./workspace-monitor.js";
import { dropEmptyIdentityEnv } from "./vcs/env.js";

// Before anything spawns a child: an empty GIT_AUTHOR_* inherited from the
// host beats every git config file and then fails the commit outright. See
// `vcs/env.ts`.
const droppedIdentityVars = dropEmptyIdentityEnv();
if (droppedIdentityVars.length > 0) {
  console.error(
    `overseer: ignoring empty ${droppedIdentityVars.join(", ")} from the environment`,
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");

const port = Number(process.env.PORT ?? 3000);
// Bind loopback-only by default (spec/architecture.md §6); the Docker image sets
// HOST=0.0.0.0 and relies on compose's port mapping instead — "127.0.0.1:3000:3000"
// in production, "127.0.0.1:3001:3000" in dev so both stacks can run at once.
const host = process.env.HOST ?? "127.0.0.1";

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  // Dev serves the UI from Vite on :5173, not from here. Never fall back to
  // web/dist in dev — a stale host build there would silently mask live edits.
  app.get("*", (_req, res) => {
    res
      .status(404)
      .type("text/plain")
      .send("overseer dev: this is the API/WS server. The app is at http://127.0.0.1:5173");
  });
}

const httpServer = createServer(app);
// CLIs run in this same container, so their hooks reach the server on
// loopback whatever interface it is bound to.
const { broadcast, space, refreshSessions, consoles, relay } = attachWebSocketServer(
  httpServer,
  { hookBase: `http://127.0.0.1:${port}` },
);

// Lifecycle reports from CLI hooks (console-registry.ts). Loopback only, and
// the path carries a per-console secret: a hook is a `curl` from a process
// this server spawned, never a browser.
app.post("/hooks/:id/:token", (req, res) => {
  const remote = req.socket.remoteAddress ?? "";
  if (!isLoopback(remote)) {
    res.status(403).end();
    return;
  }
  const activity = typeof req.query.activity === "string" ? req.query.activity : "";
  const ok = consoles.reportHook(req.params.id, req.params.token, activity);
  res.status(ok ? 204 : 404).end();
});

// Agent-to-agent relay (spec/behaviour/relay.md §5): the `overseer` command
// in an agent console posts here with that console's own hook token, so an
// agent can only ever relay as itself. Both routes are POST: the SPA's
// catch-all already owns GET.
app.post("/relay/:id/:token", async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress ?? "")) {
    res.status(403).end();
    return;
  }
  const self = consoles.verify(req.params.id, req.params.token);
  if (self?.callsign === undefined) {
    res.status(404).end();
    return;
  }
  const body = (req.body ?? {}) as { to?: unknown; text?: unknown };
  if (
    typeof body.to !== "string" ||
    body.to.length === 0 ||
    body.to.length > 64 ||
    typeof body.text !== "string" ||
    body.text.length > SESSION_MAX_TEXT_CHARS
  ) {
    res.status(400).json({ state: "refused", reason: "expected { to, text }" });
    return;
  }
  const outcome = await relay.relay({
    to: body.to,
    text: body.text,
    from: { kind: "agent", consoleId: self.id, callsign: self.callsign },
  });
  res.json(outcome);
});

app.post("/relay/:id/:token/roster", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress ?? "")) {
    res.status(403).end();
    return;
  }
  const self = consoles.verify(req.params.id, req.params.token);
  if (self?.callsign === undefined) {
    res.status(404).end();
    return;
  }
  res.json({ self: self.callsign, roster: relay.roster() });
});

process.on("SIGTERM", () => {
  relay.dispose();
  consoles.dispose();
  process.exit(0);
});
startUsageRefresh(broadcast, space);
startWorkspaceMonitor(broadcast, space);
// Sessions the app did not start — a dev loop, a raw console — only exist on
// disk until something notices them.
startTranscriptMonitor(refreshSessions);

httpServer.listen(port, host, () => {
  console.log(`overseer server listening on http://${host}:${port}`);
});
