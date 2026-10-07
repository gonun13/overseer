import type {
  AgentAdapter,
  AdapterStatus,
  LoginHandle,
  LoginUpdate,
} from "@overseer/protocol";
import {
  connect,
  withClient,
  type ClientFactory,
  type RpcClient,
} from "./app-server.js";
import { sessionStore, sessionsWatchPath } from "./sessions.js";
import { parseUsage, type RateLimits } from "./usage.js";

const LOGIN_TIMEOUT_MS = 15 * 60_000;
interface AccountResult {
  account: { type: string } | null;
  requiresOpenaiAuth: boolean;
}

export function createCodexAdapter(
  factory: ClientFactory = connect,
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
): AgentAdapter {
  const getStatus = async (): Promise<AdapterStatus> => {
    try {
      return await withClient(factory, async (client) => {
        const result = await client.request<AccountResult>("account/read", {
          refreshToken: true,
        });
        if (result.account?.type === "chatgpt")
          return { authenticated: true, usageState: "pending" };
        return {
          authenticated: false,
          detail: result.account ? "sign in with ChatGPT" : "not signed in",
        };
      });
    } catch {
      return {
        authenticated: false,
        reachable: false,
        detail: "Codex account status unavailable",
      };
    }
  };

  const refreshUsage = async (): Promise<AdapterStatus> => {
    const status = await getStatus();
    if (!status.authenticated) return status;
    try {
      const windows = await withClient(factory, async (client) =>
        parseUsage(await client.request<RateLimits>("account/rateLimits/read")),
      );
      return {
        ...status,
        usageState: windows.length ? "ready" : "unavailable",
        ...(windows.length ? { usage: windows } : {}),
      };
    } catch {
      return { ...status, usageState: "unavailable" };
    }
  };

  const start = (onUpdate: (update: LoginUpdate) => void): LoginHandle => {
    onUpdate({ phase: "starting" });
    let cancelled = false;
    let client: RpcClient | undefined;
    let loginId: string | undefined;
    let complete!: (success: boolean) => void;
    const completion = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    const done = (async (): Promise<AdapterStatus> => {
      let success = false;
      let detail = "Codex login failed";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: (() => void) | undefined;
      // A notification may arrive before the login/start response.
      const outcomes = new Map<string, boolean>();
      try {
        client = await factory(loginTimeoutMs + 10_000);
        if (cancelled) throw new Error("cancelled");
        void client.closed?.then(() => complete(false));
        unsubscribe = client.onNotification((notification) => {
          if (notification.method !== "account/login/completed") return;
          const params = notification.params as {
            loginId?: string;
            success?: boolean;
          } | null;
          if (!params || typeof params.loginId !== "string") return;
          outcomes.set(params.loginId, params.success === true);
          if (params.loginId === loginId) complete(params.success === true);
        });
        const result = await client.request<{
          type: string;
          loginId: string;
          verificationUrl: string;
          userCode: string;
        }>("account/login/start", { type: "chatgptDeviceCode" });
        loginId = result.loginId;
        if (cancelled) {
          await client
            .request("account/login/cancel", { loginId })
            .catch(() => undefined);
          throw new Error("cancelled");
        }
        if (
          result.type !== "chatgptDeviceCode" ||
          !loginId ||
          !result.userCode ||
          !result.verificationUrl.startsWith("https://")
        ) {
          throw new Error("invalid login response");
        }
        onUpdate({
          phase: "awaiting-browser",
          verificationUrl: result.verificationUrl,
          userCode: result.userCode,
        });
        timer = setTimeout(() => {
          detail = "Codex login timed out";
          complete(false);
        }, loginTimeoutMs);
        if (outcomes.has(loginId)) complete(outcomes.get(loginId)!);
        success = await completion;
        if (!success)
          await client
            .request("account/login/cancel", { loginId })
            .catch(() => undefined);
      } catch {
        /* Never surface RPC inputs or raw auth errors. */
      } finally {
        if (timer) clearTimeout(timer);
        unsubscribe?.();
        await client?.close();
      }
      const status = await getStatus();
      success = success && !cancelled && status.authenticated;
      onUpdate({
        phase: success ? "success" : "failed",
        status,
        ...(!success ? { detail: cancelled ? "login cancelled" : detail } : {}),
      });
      return status;
    })();
    return {
      submitCode() {
        /* Device grants are entered only in the browser. */
      },
      cancel() {
        cancelled = true;
        complete(false);
        // During initialization/start there is no login id yet. Closing also
        // aborts the pending request; the done path always reaps the child.
        if (!loginId) void client?.close();
      },
      done,
    };
  };

  return {
    id: "codex",
    capabilities: { login: true, usageCheck: true },
    getStatus,
    refreshUsage,
    async checkUsage() {
      const status = await refreshUsage();
      if (!status.authenticated)
        return { ok: false, reason: "Codex is not signed in with ChatGPT" };
      if (!status.usage?.length)
        return { ok: false, reason: "usage currently not available" };
      return {
        ok: true,
        windows: status.usage,
        report: status.usage
          .map(
            (w) =>
              `${w.label}: ${Math.round(w.used * 100)}% used${w.resets ? `; resets ${w.resets}` : ""}`,
          )
          .join("\n"),
      };
    },
    login: {
      start,
      async signOut() {
        await withClient(factory, (client) =>
          client.request<void>("account/logout"),
        );
      },
    },
    async consoleCommand(opts) {
      if (!opts.sessionId) throw new Error("Codex requires a prepared session");
      // The container is the sandbox: Docker refuses the user namespaces
      // bubblewrap needs, so Codex's own sandbox could only warn and fail.
      // Approval prompts are untouched. The update check is off in the
      // image's /etc/codex/config.toml, not here: a `-c` override would force
      // the TUI off its shared background server.
      const args = [
        "resume",
        "--no-daemon",
        "--sandbox",
        "danger-full-access",
        opts.sessionId,
      ];
      if (opts.prompt !== undefined && !opts.resume)
        args.push("--", opts.prompt);
      return { file: "codex", args, cwd: opts.cwd };
    },
    relayInput: (text) => `\x1b[200~${text}\x1b[201~\r`,
    sessionsWatchPath,
    sessions: sessionStore(factory),
  };
}

export const codexAdapter = createCodexAdapter();
export default codexAdapter;
