import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  LoopConfigMessage,
  LoopModelsMessage,
  LoopProviderInfo,
  ProviderOption,
} from "@overseer/protocol";
import { readProviderManifests } from "./provider-registry.js";

/**
 * The loop's own provider/model configuration, read and written through its
 * own `loop/bin/*` scripts rather than reimplemented here — `loop/bin/models
 * --json`'s step list comes straight from `db.sh`'s `LOOP_STEPS` table
 * (`step_names`), which is the one source of truth for what a step is; a
 * second copy in TypeScript would drift the moment a step is added.
 *
 * Entirely independent of the app's own attached provider
 * (`provider-registry.ts`, `adapters.ts`, `session-supervisor.ts`): the loop
 * picks its own (`loop/.provider`) and always has, per
 * `loop/bin/lib/providers.sh`'s `resolve_provider_id`.
 */

const LOOP_BIN_MODELS = process.env.OVERSEER_LOOP_BIN_MODELS ?? "/app/loop/bin/models";
const LOOP_BIN_PROVIDER = process.env.OVERSEER_LOOP_BIN_PROVIDER ?? "/app/loop/bin/provider";

const TIMEOUT_MS = 15_000;

export type RunLoopBin = (bin: string, args: string[]) => Promise<{ stdout: string }>;

const defaultRun: RunLoopBin = async (bin, args) => {
  const run = promisify(execFile);
  return run(bin, args, { timeout: TIMEOUT_MS });
};

export interface LoopConfigDeps {
  run?: RunLoopBin;
  /** Seam for tests — the shared registry read is otherwise process-global. */
  readProviderManifests?: typeof readProviderManifests;
}

interface ModelsJson {
  providers: Record<string, { overseer: string | null; steps: Record<string, string> }>;
  steps: string[];
  current: string;
}

/** `loop/bin/models --json` plus each provider's `loopSubagents` manifest
 * field, folded into one wire frame. Never throws on a bad `--json` reply —
 * that would take the loop tab down for every provider, not just the one
 * whose config is malformed — so a parse failure reports an empty, current-
 * only config instead. */
export async function readLoopConfig(deps: LoopConfigDeps = {}): Promise<LoopConfigMessage> {
  const run = deps.run ?? defaultRun;
  const readManifests = deps.readProviderManifests ?? readProviderManifests;

  let parsed: ModelsJson | undefined;
  try {
    const { stdout } = await run(LOOP_BIN_MODELS, ["--json"]);
    parsed = JSON.parse(stdout) as ModelsJson;
  } catch (error) {
    console.error("loop-config: could not read loop/bin/models --json", error);
  }

  const verifiedById = new Map(
    readManifests().map((m) => [m.id, m.loopSubagents !== "unverified"]),
  );

  const providers: LoopProviderInfo[] = Object.entries(parsed?.providers ?? {}).map(
    ([id, cfg]) => ({
      id,
      subagentsVerified: verifiedById.get(id) ?? true,
      overseer: cfg.overseer,
      steps: cfg.steps,
    }),
  );

  return {
    type: "loop.config",
    current: parsed?.current ?? "",
    providers,
    steps: parsed?.steps ?? [],
  };
}

/** `loop/bin/provider <id>` — validates against the loop-runnable providers
 * itself; a bad id surfaces as a rejected promise carrying its message. */
export async function setLoopProvider(id: string, deps: LoopConfigDeps = {}): Promise<void> {
  const run = deps.run ?? defaultRun;
  await run(LOOP_BIN_PROVIDER, [id]);
}

/** `loop/bin/models set <provider> <slot> <model>` — `model` empty clears the
 * slot back to inherit. Step-name and provider validation happens in the
 * script, against `db.sh`'s live table, not duplicated here. */
export async function setLoopModel(
  providerId: string,
  slot: string,
  model: string,
  deps: LoopConfigDeps = {},
): Promise<void> {
  const run = deps.run ?? defaultRun;
  await run(LOOP_BIN_MODELS, ["set", providerId, slot, model]);
}

interface ListModelsJson {
  models: ProviderOption[];
  defaultModel: string | null;
}

/**
 * The models `providerId` actually offers — `loop/bin/models list-models
 * <providerId>`, which asks that provider's own CLI directly
 * (`provider_list_models` in its `provider.sh`), independent of the app's
 * attached provider. This is the fix for the loop tab only ever being able
 * to show models for whichever provider the app happened to have attached:
 * the loop's own provider is configured separately, and its model list has
 * to come from the same place its config does.
 *
 * Never throws — a provider that cannot list models (not signed in, no
 * `provider_list_models`, a CLI error) reports an empty list rather than
 * failing the whole window, the same "report nothing rather than a guess"
 * rule `AgentAdapter.listOptions` follows.
 */
export async function readLoopModels(
  providerId: string,
  deps: LoopConfigDeps = {},
): Promise<LoopModelsMessage> {
  const run = deps.run ?? defaultRun;

  let parsed: ListModelsJson | undefined;
  try {
    const { stdout } = await run(LOOP_BIN_MODELS, ["list-models", providerId]);
    parsed = JSON.parse(stdout) as ListModelsJson;
  } catch (error) {
    console.error(
      `loop-config: could not list models for '${providerId}'`,
      error,
    );
  }

  return {
    type: "loop.models",
    providerId,
    models: parsed?.models ?? [],
    ...(parsed?.defaultModel !== undefined && parsed.defaultModel !== null
      ? { defaultModel: parsed.defaultModel }
      : {}),
  };
}
