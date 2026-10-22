import type { AdapterStatus, AgentAdapter } from "@overseer/protocol";
import { type CliRunner, cliRunner, connectedProviders } from "./cli.js";
import { consoleCommand, relayInput } from "./console.js";
import { type ServeFactory, serveFactory } from "./serve.js";
import {
  createSession,
  dataDir,
  isSessionsChange,
  sessionStore,
} from "./sessions.js";

/**
 * opencode fronts many model providers and answers on its own free models
 * with no credential at all, so there is no single account to sign in to:
 * connecting a provider happens in its own TUI (`/connect`), and this adapter
 * offers no login. Ready means the CLI answered and lists at least one model.
 *
 * It reads no usage either — the CLI's own figures are list-price estimates,
 * not a plan's quota.
 */
export function createOpencodeAdapter(
  deps: {
    cli?: CliRunner;
    serve?: ServeFactory;
    env?: NodeJS.ProcessEnv;
  } = {},
): AgentAdapter {
  const env = deps.env ?? process.env;
  const cli = deps.cli ?? cliRunner(env);
  const serve = deps.serve ?? serveFactory(env);

  const getStatus = async (): Promise<AdapterStatus> => {
    const [version, models] = await Promise.all([
      cli(["--version"], { timeoutMs: 5_000 }),
      cli(["models"], { timeoutMs: 30_000 }),
    ]);
    if (version.code !== 0)
      return {
        authenticated: false,
        reachable: false,
        detail: "opencode CLI not found on PATH",
      };
    const versionText = version.stdout.trim();
    const providers =
      models.code === 0 ? connectedProviders(models.stdout) : [];
    if (providers.length === 0)
      return {
        authenticated: false,
        version: versionText,
        detail: "no models available · connect a provider in opencode",
      };
    const others = providers.filter((id) => id !== "opencode");
    return {
      authenticated: true,
      version: versionText,
      detail:
        others.length === 0
          ? "ready · free models"
          : `ready · ${others.join(", ")}`,
      // Stamped up front: with no refresh to run, an absent state would read
      // as "retrieving" forever.
      usageState: "unavailable",
    };
  };

  return {
    id: "opencode",
    capabilities: { login: false, usageCheck: false },
    getStatus,
    consoleCommand,
    relayInput,
    sessionsWatchPath: () => dataDir(env),
    isSessionsChange,
    sessions: sessionStore({ serve, cli, env }),
  };
}

export const opencodeAdapter = createOpencodeAdapter();
export default opencodeAdapter;

/** For the dev loop's bundle: one empty session in `projectDir`, by id. */
export function prepareSession(projectDir: string): Promise<string> {
  return createSession(serveFactory(), projectDir);
}
