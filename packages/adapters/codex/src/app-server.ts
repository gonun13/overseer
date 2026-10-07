import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface Notification {
  method: string;
  params: unknown;
}
export interface RpcClient {
  request<T>(method: string, params?: unknown): Promise<T>;
  onNotification(listener: (notification: Notification) => void): () => void;
  close(): Promise<void>;
  readonly closed?: Promise<void>;
}

/** Pinned Codex 0.160.1 newline-delimited stdio protocol. No protocol payload
 * or stderr is logged: either may contain credentials or device grants. */
export class AppServer implements RpcClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(notification: Notification) => void>();
  private buffer = "";
  private stopped?: Error;
  private deadline: ReturnType<typeof setTimeout>;
  private killTimer?: ReturnType<typeof setTimeout>;
  private exited: Promise<void>;

  constructor(
    opts: {
      timeoutMs?: number;
      file?: string;
      args?: string[];
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.child = spawn(opts.file ?? "codex", opts.args ?? ["app-server"], {
      stdio: "pipe",
      env: opts.env ?? process.env,
    });
    this.exited = new Promise((resolve) =>
      this.child.once("close", () => {
        this.stop(new Error("Codex App Server closed"));
        if (this.killTimer) clearTimeout(this.killTimer);
        resolve();
      }),
    );
    this.child.once("error", () =>
      this.stop(new Error("Codex App Server could not start")),
    );
    this.child.stdin.on("error", () =>
      this.stop(new Error("Codex App Server input closed")),
    );
    this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.read(chunk));
    this.deadline = setTimeout(
      () => this.stop(new Error("Codex App Server timed out")),
      opts.timeoutMs ?? 10_000,
    );
  }

  get closed(): Promise<void> {
    return this.exited;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "overseer", title: "Overseer", version: "0.6.2" },
    });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.stop(new Error("Codex App Server request timed out")),
        10_000,
      );
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  onNotification(listener: (notification: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    // Bound both unframed data and frame sizes, including a child that never replies.
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.stop(new Error("Codex App Server response exceeded limit"));
      return;
    }
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let frame: {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: unknown;
      };
      try {
        frame = JSON.parse(line);
      } catch {
        this.stop(new Error("Invalid Codex App Server response"));
        return;
      }
      if (frame === null || typeof frame !== "object") {
        this.stop(new Error("Invalid Codex App Server response"));
        return;
      }
      if (frame.id !== undefined) {
        const pending = this.pending.get(frame.id);
        if (pending) {
          this.pending.delete(frame.id);
          clearTimeout(pending.timer);
          // Raw RPC errors can echo inputs. Only the method's caller supplies prose.
          if (frame.error !== undefined)
            pending.reject(new Error("Codex App Server request failed"));
          else pending.resolve(frame.result);
        } else if (frame.method) {
          this.child.stdin.write(
            JSON.stringify({
              id: frame.id,
              error: { code: -32601, message: "Unsupported client request" },
            }) + "\n",
          );
        }
      } else if (typeof frame.method === "string") {
        for (const listener of this.listeners)
          listener({ method: frame.method, params: frame.params });
      }
    }
  }

  private stop(error: Error): void {
    if (this.stopped) return;
    this.stopped = error;
    clearTimeout(this.deadline);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 500);
    }
  }

  async close(): Promise<void> {
    this.stop(new Error("Codex App Server closed"));
    await this.exited;
  }
}

export type ClientFactory = (timeoutMs?: number) => Promise<RpcClient>;
export const connect: ClientFactory = async (timeoutMs) => {
  const client = new AppServer({ timeoutMs });
  try {
    await client.initialize();
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
};

export async function withClient<T>(
  factory: ClientFactory,
  run: (client: RpcClient) => Promise<T>,
): Promise<T> {
  const client = await factory();
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}
