import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The shared provider registry at `providers/` — one directory per provider,
 * each with a `manifest.json`. It is the single declaration of what a provider
 * is, read by both sides of this repo: here, to build the adapter catalog, and
 * by `loop/bin/lib/providers.sh`, to find a bundle it can open a session on.
 *
 * A provider can be implemented on one side, the other, or both, which is what
 * the two role fields say:
 *
 * - `app`   — `"adapter"` when this server has real wiring for it, `"stub"`
 *             when the CLI is in the image but sessions/auth/console are not
 *             built yet, `"none"` when the app should not list it at all.
 * - `loop`  — `"bundle"` when the directory also carries `provider.sh` and the
 *             loop can run it, `"none"` otherwise.
 *
 * Where the registry lives is a deployment fact the container states, for the
 * same reason `CLAUDE_CONFIG_DIR` and the workspace root are (workspace.ts).
 */
export const PROVIDERS_DIR =
  process.env.OVERSEER_PROVIDERS_DIR ?? "/app/providers";

export type ProviderAppRole = "adapter" | "stub" | "none";
export type ProviderLoopRole = "bundle" | "none";

export interface ProviderManifest {
  id: string;
  /** The CLI binary name, e.g. `claude`. */
  cli: string;
  /** Config directory the CLI reads, relative to the bundle or to `$HOME`. */
  configDir: string;
  app: ProviderAppRole;
  loop: ProviderLoopRole;
}

function isRole<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Parse one manifest. Returns `undefined` for anything malformed rather than
 * throwing: one bad file in the registry must not stop the server booting, and
 * the provider it describes is better absent than half-described. The reason is
 * logged so it is not silent.
 */
function parseManifest(dir: string, raw: string): ProviderManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unparseable";
    console.error(`provider-registry: ${dir}/manifest.json is not valid JSON — ${detail}`);
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    console.error(`provider-registry: ${dir}/manifest.json is not an object`);
    return undefined;
  }

  const { id, cli, configDir, app, loop } = value as Record<string, unknown>;

  if (id !== dir) {
    console.error(
      `provider-registry: ${dir}/manifest.json declares id "${String(id)}", which is not its directory name`,
    );
    return undefined;
  }
  if (typeof cli !== "string" || cli.length === 0) {
    console.error(`provider-registry: ${dir}/manifest.json must set a non-empty "cli"`);
    return undefined;
  }
  if (typeof configDir !== "string" || configDir.length === 0) {
    console.error(`provider-registry: ${dir}/manifest.json must set a non-empty "configDir"`);
    return undefined;
  }
  if (!isRole(app, ["adapter", "stub", "none"] as const)) {
    console.error(`provider-registry: ${dir}/manifest.json "app" must be adapter, stub or none`);
    return undefined;
  }
  if (!isRole(loop, ["bundle", "none"] as const)) {
    console.error(`provider-registry: ${dir}/manifest.json "loop" must be bundle or none`);
    return undefined;
  }

  return { id, cli, configDir, app, loop };
}

/**
 * Every manifest in the registry, sorted by id so the catalog's order is a
 * property of the registry and not of directory iteration.
 *
 * Read synchronously: this runs once, at import, and where the registry lives
 * is settled before anything can ask for an adapter.
 */
export function readProviderManifests(
  root = PROVIDERS_DIR,
): ProviderManifest[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable";
    console.error(`provider-registry: cannot read ${root} — ${detail}`);
    return [];
  }

  const manifests: ProviderManifest[] = [];
  for (const dir of entries.sort()) {
    let raw: string;
    try {
      raw = readFileSync(path.join(root, dir, "manifest.json"), "utf8");
    } catch {
      // A directory without a manifest is not a provider. Silent by design:
      // the registry is a normal directory and may hold a README.
      continue;
    }
    const manifest = parseManifest(dir, raw);
    if (manifest !== undefined) manifests.push(manifest);
  }
  return manifests;
}
