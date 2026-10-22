/**
 * An opencode plugin, loaded by the CLI itself (named by file URL in
 * `OPENCODE_CONFIG_CONTENT`, console.ts) — never imported by Overseer. It runs
 * inside opencode's server process, so it imports nothing from outside this
 * package's own `dist/`.
 *
 * Three jobs, each switched on by an environment variable the console sets:
 *
 * - Activity. Lifecycle events become `POST <hook>?activity=…`, the same
 *   loopback endpoint Claude Code's hooks reach. Verified events on the pinned
 *   1.19.4: `session.status` busy/idle per session, `permission.asked` and
 *   `question.asked` when the TUI stops for the operator, `…replied` /
 *   `…rejected` when it is answered.
 * - The opening prompt of a session Overseer created empty, which `--prompt`
 *   cannot deliver beside `--session`. Sent once, and only into a session that
 *   has no messages, so a reloaded instance never sends it twice.
 * - The relay brief, appended to the system prompt of the operator's sessions.
 *
 * Child sessions belong to subagents. Their status is not the console's — the
 * parent stays busy while they run — but their permission prompts are.
 */

import { PLUGIN_ENV } from "./console.js";

type Activity = "working" | "waiting" | "idle";

interface PluginEvent {
  type: string;
  properties?: {
    sessionID?: string;
    info?: { id?: string; parentID?: string | null };
    status?: { type?: string };
  };
}

interface PluginClient {
  session: {
    messages(opts: { path: { id: string } }): Promise<{ data?: unknown[] }>;
    promptAsync(opts: {
      path: { id: string };
      body: { parts: Array<{ type: "text"; text: string }> };
    }): Promise<unknown>;
  };
}

const ENV = PLUGIN_ENV;

/** Read once per process: taken out of the environment so the agent's own
 * shells do not inherit an opening prompt, and a reload cannot resend it. */
const opening = {
  session: process.env[ENV.session],
  prompt: process.env[ENV.prompt],
};
delete process.env[ENV.session];
delete process.env[ENV.prompt];

async function sendOpeningPrompt(client: PluginClient): Promise<void> {
  const { session, prompt } = opening;
  opening.session = opening.prompt = undefined;
  if (!session || !prompt) return;
  const messages = await client.session.messages({ path: { id: session } });
  if ((messages.data?.length ?? 0) > 0) return;
  await client.session.promptAsync({
    path: { id: session },
    body: { parts: [{ type: "text", text: prompt }] },
  });
}

export const OverseerPlugin = async ({ client }: { client: PluginClient }) => {
  const hookUrl = process.env[ENV.hookUrl];
  const brief = process.env[ENV.brief];
  const children = new Set<string>();
  let last: Activity | undefined;

  const report = (activity: Activity) => {
    if (!hookUrl || activity === last) return;
    last = activity;
    // Fire and forget: a hook can never hold up or fail a turn.
    void fetch(`${hookUrl}?activity=${activity}`, {
      method: "POST",
      signal: AbortSignal.timeout(2_000),
    }).catch(() => undefined);
  };

  void sendOpeningPrompt(client).catch(() => undefined);

  return {
    async event({ event }: { event: PluginEvent }) {
      const props = event.properties ?? {};
      switch (event.type) {
        case "session.created":
        case "session.updated":
          if (props.info?.id && props.info.parentID)
            children.add(props.info.id);
          return;
        case "session.status":
          if (props.sessionID && children.has(props.sessionID)) return;
          if (props.status?.type === "idle") report("idle");
          else if (props.status?.type) report("working");
          return;
        case "permission.asked":
        case "question.asked":
          report("waiting");
          return;
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          report("working");
          return;
      }
    },
    async "experimental.chat.system.transform"(
      input: { sessionID?: string },
      output: { system: string[] },
    ) {
      if (brief && !(input.sessionID && children.has(input.sessionID)))
        output.system.push(brief);
    },
  };
};
