import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { CLI, opencodeEnv } from "./cli.js";

/**
 * A short-lived `opencode serve` — the CLI's own HTTP API, used for the one
 * thing no subcommand does: create an empty session to hand the TUI by id.
 *
 * Verified against the pinned 1.19.4: `--port 0` prefers 4096 and falls back
 * to a random port when that is taken, and prints
 * `opencode server listening on http://127.0.0.1:<port>` once ready (~0.5s).
 * It binds loopback only, and a random `OPENCODE_SERVER_PASSWORD` puts basic
 * auth (user `opencode`) in front of it, so another process in the container
 * cannot drive it for the moment it is up. Bodies are never logged.
 */

export interface ServeClient {
  request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts?: { query?: Record<string, string>; body?: unknown },
  ): Promise<T>;
  close(): Promise<void>;
}

export type ServeFactory = (cwd: string) => Promise<ServeClient>;

const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/;
const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 1_000;

export function serveFactory(
  env: NodeJS.ProcessEnv = process.env,
): ServeFactory {
  return (cwd) =>
    new Promise<ServeClient>((resolve, reject) => {
      const password = randomBytes(24).toString("hex");
      const child = spawn(
        CLI,
        ["serve", "--port", "0", "--hostname", "127.0.0.1"],
        {
          cwd,
          env: {
            ...opencodeEnv(env),
            OPENCODE_SERVER_USERNAME: "opencode",
            OPENCODE_SERVER_PASSWORD: password,
          },
          stdio: ["ignore", "pipe", "pipe"],
          // Its own process group, so the language servers and tools it may
          // start die with it.
          detached: true,
        },
      );
      const exited = new Promise<void>((done) => child.once("close", done));
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = async () => {
        if (child.exitCode === null && child.signalCode === null) {
          signal("SIGTERM");
          killTimer = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
        }
        await exited;
        if (killTimer) clearTimeout(killTimer);
      };
      const signal = (name: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, name);
        } catch {
          child.kill(name);
        }
      };

      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        void kill().then(() => reject(new Error(message)));
      };
      const deadline = setTimeout(
        () => fail("opencode serve did not start"),
        START_TIMEOUT_MS,
      );
      child.once("error", () => fail("opencode serve could not start"));
      void exited.then(() => fail("opencode serve exited"));
      child.stderr.resume();

      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        buffer = (buffer + chunk).slice(-4096);
        const match = LISTENING.exec(buffer);
        if (!match) return;
        settled = true;
        clearTimeout(deadline);
        const base = match[1]!;
        const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
        resolve({
          async request<T>(
            method: "GET" | "POST" | "DELETE",
            path: string,
            opts: { query?: Record<string, string>; body?: unknown } = {},
          ): Promise<T> {
            const url = new URL(path, base);
            for (const [key, value] of Object.entries(opts.query ?? {}))
              url.searchParams.set(key, value);
            const response = await fetch(url, {
              method,
              headers: {
                authorization: auth,
                ...(opts.body !== undefined
                  ? { "content-type": "application/json" }
                  : {}),
              },
              ...(opts.body !== undefined
                ? { body: JSON.stringify(opts.body) }
                : {}),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            // The error body can echo the request; only the status is kept.
            if (!response.ok)
              throw new Error(`opencode serve answered ${response.status}`);
            const text = await response.text();
            return (text === "" ? undefined : JSON.parse(text)) as T;
          },
          close: kill,
        });
      });
    });
}

export async function withServe<T>(
  factory: ServeFactory,
  cwd: string,
  run: (client: ServeClient) => Promise<T>,
): Promise<T> {
  const client = await factory(cwd);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}
