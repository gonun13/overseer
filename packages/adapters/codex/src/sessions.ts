import path from "node:path";
import { homedir } from "node:os";
import type { SessionMeta } from "@overseer/protocol";
import { type ClientFactory, withClient } from "./app-server.js";

/** Minimal subset of the generated 0.160.1 Thread type. Use id, never sessionId:
 * descendants share the latter with their parent. */
export interface Thread {
  id: string;
  cwd: string;
  name?: string | null;
  preview?: string;
  createdAt: number;
  updatedAt: number;
  source: unknown;
  parentThreadId?: string | null;
  ephemeral?: boolean;
  gitInfo?: { branch?: string | null } | null;
}
export const GENERIC_TITLE = "new session";
export function title(thread: Thread): string {
  const name = thread.name?.trim();
  const preview = thread.preview?.trim();
  return (
    name && name !== GENERIC_TITLE ? name : preview || name || GENERIC_TITLE
  ).slice(0, 160);
}
function interactive(thread: Thread): boolean {
  return (
    !thread.parentThreadId &&
    !thread.ephemeral &&
    ["cli", "vscode", "appServer"].includes(thread.source as string)
  );
}
function meta(thread: Thread): SessionMeta {
  return {
    id: thread.id,
    adapterId: "codex",
    name: title(thread),
    projectDir: thread.cwd,
    ...(thread.gitInfo?.branch ? { gitBranch: thread.gitInfo.branch } : {}),
    status: "dormant",
    createdAt: new Date(thread.createdAt * 1000).toISOString(),
    lastActiveAt: new Date(thread.updatedAt * 1000).toISOString(),
    totalCostUsd: 0,
  };
}
export function sessionsWatchPath(): string {
  return path.join(
    process.env.CODEX_HOME || path.join(homedir(), ".codex"),
    "sessions",
  );
}

export function sessionStore(factory: ClientFactory) {
  const read = (projectDir: string, sessionId: string) =>
    withClient(factory, async (client) => {
      const { thread } = await client.request<{ thread: Thread }>(
        "thread/read",
        { threadId: sessionId, includeTurns: false },
      );
      if (thread.cwd !== projectDir || !interactive(thread))
        throw new Error("Codex session does not belong to this project");
      return thread;
    });
  return {
    async listProjectSessions(projectDir: string): Promise<SessionMeta[]> {
      return withClient(factory, async (client) => {
        const threads = new Map<string, SessionMeta>();
        const cursors = new Set<string>();
        let cursor: string | null = null;
        do {
          const page: { data: Thread[]; nextCursor: string | null } =
            await client.request<{ data: Thread[]; nextCursor: string | null }>(
              "thread/list",
              {
                cwd: projectDir,
                modelProviders: [],
                sourceKinds: ["cli", "vscode", "appServer"],
                limit: 100,
                sortKey: "updated_at",
                cursor,
              },
            );
          for (const thread of page.data) {
            if (thread.cwd === projectDir && interactive(thread))
              threads.set(thread.id, meta(thread));
          }
          cursor = page.nextCursor;
          if (cursor) {
            if (cursors.has(cursor))
              throw new Error("Codex session pagination repeated a cursor");
            cursors.add(cursor);
          }
        } while (cursor);
        return [...threads.values()];
      });
    },
    async mintSessionId(opts: {
      projectDir: string;
      prompt?: string;
    }): Promise<string> {
      return withClient(factory, async (client) => {
        const { thread } = await client.request<{ thread: Thread }>(
          "thread/start",
          {
            cwd: opts.projectDir,
            ephemeral: false,
          },
        );
        try {
          await client.request("thread/name/set", {
            threadId: thread.id,
            name: opts.prompt?.trim().slice(0, 160) || GENERIC_TITLE,
          });
          // A started, named thread has no rollout yet, so `codex resume`
          // would refuse it. Resuming it while still loaded writes one
          // without adding turns.
          await client.request("thread/resume", { threadId: thread.id });
          return thread.id;
        } catch (error) {
          await client
            .request("thread/delete", { threadId: thread.id })
            .catch(() => undefined);
          throw error;
        }
      });
    },
    async lookupSessionTitle(
      projectDir: string,
      sessionId: string,
    ): Promise<string | undefined> {
      return title(await read(projectDir, sessionId));
    },
    async deleteSession(projectDir: string, sessionId: string): Promise<void> {
      await read(projectDir, sessionId);
      await withClient(factory, (client) =>
        client.request<void>("thread/delete", { threadId: sessionId }),
      );
    },
    async discardPreparedSession(
      projectDir: string,
      sessionId: string,
    ): Promise<void> {
      await this.deleteSession(projectDir, sessionId);
    },
  };
}
