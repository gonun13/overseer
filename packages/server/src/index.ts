import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachWebSocketServer } from "./ws.js";
import { listAdapters } from "./adapters.js";
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
// Bind loopback-only by default (design doc §6); the Docker image sets
// HOST=0.0.0.0 and relies on compose's port mapping instead — "127.0.0.1:3000:3000"
// in production, "127.0.0.1:3001:3000" in dev so both stacks can run at once.
const host = process.env.HOST ?? "127.0.0.1";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/providers", (_req, res) => {
  res.json(
    listAdapters().map(({ id, capabilities }) => ({ id, capabilities })),
  );
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
const { broadcast, refreshSessions } = attachWebSocketServer(httpServer);
startUsageRefresh(broadcast);
startWorkspaceMonitor(broadcast);
// Sessions the app did not start — a dev loop, a raw console — only exist on
// disk until something notices them.
startTranscriptMonitor(refreshSessions);

httpServer.listen(port, host, () => {
  console.log(`overseer server listening on http://${host}:${port}`);
});
