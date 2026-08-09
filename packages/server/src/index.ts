import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachWebSocketServer } from "./ws.js";
import { listAdapters } from "./adapters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");

const port = Number(process.env.PORT ?? 3000);
// Bind loopback-only by default (design doc §6); the Docker image sets
// HOST=0.0.0.0 and relies on compose's "127.0.0.1:3000:3000" port mapping instead.
const host = process.env.HOST ?? "127.0.0.1";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/adapters", (_req, res) => {
  res.json(listAdapters().map(({ id, capabilities }) => ({ id, capabilities })));
});

app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(port, host, () => {
  console.log(`overseer server listening on http://${host}:${port}`);
});
