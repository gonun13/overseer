import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SKILL_MAX_UPLOAD_TOTAL_CHARS,
  type SkillSource,
  type SkillUploadFile,
} from "@overseer/protocol";
import { cloneInto } from "./vcs/index.js";
import { WORKSPACE_ROOT } from "./workspace.js";

/**
 * Turning a skill source into a directory on disk, and nothing else.
 *
 * This module fetches; it never decides where a skill lands. That split is the
 * whole containment story of the importer: the server owns the transport (a
 * clone, a decode) and the adapter owns the destination, so no path an operator
 * supplied is ever joined onto a config directory. It is the same rule
 * `subagents.ts` states for agent files, applied to an artifact that arrives
 * from outside the instance.
 *
 * Staging lives under the workspace's reserved `_overseer/` directory. That is
 * already the designated staging channel (architecture-design.md §"Config
 * import/export"), and `scanWorkspace` already skips `_`-prefixed entries — so
 * a clone in flight never appears as a project. It is removed in a `finally`,
 * success or failure.
 */

/** The reserved staging channel. Underscore-prefixed, so the workspace scan
 * passes over it. */
const STAGING_ROOT = path.join(WORKSPACE_ROOT, "_overseer", "skill-import");

export type FetchResult =
  | { ok: true; dir: string; cleanup: () => Promise<void> }
  | { ok: false; reason: string };

/**
 * A forge URL an operator copied out of their browser, split into the three
 * things git needs.
 *
 * `https://github.com/o/r/tree/main/skills/pdf` is what a person actually has
 * in hand — the address of the folder they are looking at. Making them
 * decompose it into a clone URL, a branch and a subpath would be asking them to
 * do by hand what the URL already says.
 *
 * Only the `/tree/<ref>/<path>` and `/blob/<ref>/<path>` shapes are recognised,
 * because those are the two that carry a ref unambiguously. Anything else is
 * returned as a plain clone URL, which is the honest reading of a URL this
 * function does not understand.
 */
export function parseSkillGitSource(raw: string): {
  url: string;
  ref?: string;
  subpath?: string;
} {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: trimmed };
  }

  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  // owner, repo, then the marker, then at least a ref.
  const marker = segments.findIndex((s) => s === "tree" || s === "blob");
  if (marker < 2 || marker + 1 >= segments.length) {
    return { url: trimmed };
  }

  const repo = segments.slice(0, marker);
  const ref = segments[marker + 1] as string;
  const subpath = segments.slice(marker + 2).join("/");

  // A `/blob/` url points at a file. Which file decides what it means:
  //
  //   .../blob/main/skills/pdf/SKILL.md  → the skill is the folder holding it
  //   .../blob/main/skills/diagnose.md   → the skill *is* that file
  //
  // Collapsing both to the parent folder would turn a link to one flat skill
  // into a link to the whole collection it sits in, which is the opposite of
  // what the operator pointed at.
  const isBlob = segments[marker] === "blob";
  const base = subpath.split("/").pop() ?? "";
  const cleaned =
    isBlob && base === "SKILL.md"
      ? subpath.split("/").slice(0, -1).join("/")
      : subpath;

  const cloneUrl = `${parsed.protocol}//${parsed.host}/${repo.join("/")}`;
  return {
    url: cloneUrl,
    ref,
    ...(cleaned !== "" ? { subpath: cleaned } : {}),
  };
}

/**
 * Resolve a subpath inside a clone, refusing anything that leaves it.
 *
 * The wire guard already rejected `..` and absolute paths, and this checks the
 * *resolved* result anyway. The two are not redundant: the guard judges the
 * string, this judges where it landed, and a symlink inside the cloned
 * repository is visible only to the second. A repository that ships
 * `skills -> /etc` is not exotic; it is one commit.
 */
function resolveSubpath(root: string, subpath: string): string | undefined {
  const target = path.resolve(root, subpath);
  const bounded = path.resolve(root) + path.sep;
  return target === path.resolve(root) || target.startsWith(bounded)
    ? target
    : undefined;
}

async function makeStagingDir(): Promise<string> {
  await mkdir(STAGING_ROOT, { recursive: true });
  return mkdtemp(path.join(STAGING_ROOT, "s-"));
}

/** Remove a staging directory, never failing the operation that owned it. */
function cleanupFor(dir: string): () => Promise<void> {
  return async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };
}

async function fetchGit(
  source: Extract<SkillSource, { kind: "git" }>,
): Promise<FetchResult> {
  // Re-parse rather than trust the client's split: the operator may have pasted
  // a forge URL into a field the form treated as a plain clone URL.
  const parsed = parseSkillGitSource(source.url);
  const ref = source.ref ?? parsed.ref;
  const subpath = source.subpath ?? parsed.subpath;

  const staging = await makeStagingDir();
  const cleanup = cleanupFor(staging);
  const checkout = path.join(staging, "repo");

  const cloned = await cloneInto(parsed.url, ref, checkout);
  if (!cloned.ok) {
    await cleanup();
    return { ok: false, reason: cloned.reason };
  }

  if (subpath === undefined || subpath === "") {
    return { ok: true, dir: checkout, cleanup };
  }

  const resolved = resolveSubpath(checkout, subpath);
  if (resolved === undefined) {
    await cleanup();
    return { ok: false, reason: "that path leaves the repository" };
  }

  // A subpath that is not there is the likeliest thing to go wrong with a
  // pasted url, and it deserves to say so: left to the adapter it would
  // surface as "that source could not be read", which describes a missing
  // directory rather than the typo that caused it.
  // A file target is legitimate: a flat `<name>.md` is a skill. Only absence
  // is an error here — whether the thing found is importable is the adapter's
  // question, and it gives a better answer than this layer could.
  try {
    await stat(resolved);
  } catch {
    await cleanup();
    return { ok: false, reason: `${subpath} is not in that repository` };
  }

  return { ok: true, dir: resolved, cleanup };
}

async function fetchUpload(
  files: SkillUploadFile[],
): Promise<FetchResult> {
  // The wire caps each file and the running total, but a client that satisfies
  // both can still be re-checked here for free — this module is reachable from
  // tests, and one day from something that is not the socket.
  const total = files.reduce((sum, file) => sum + file.text.length, 0);
  if (total > SKILL_MAX_UPLOAD_TOTAL_CHARS) {
    return { ok: false, reason: "that skill is too large to upload" };
  }

  const staging = await makeStagingDir();
  const cleanup = cleanupFor(staging);
  const root = path.join(staging, "skill");
  await mkdir(root, { recursive: true });

  for (const file of files) {
    const resolved = resolveSubpath(root, file.path);
    if (resolved === undefined) {
      await cleanup();
      return { ok: false, reason: `that file path is not allowed: ${file.path}` };
    }
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, file.text, "utf8");
  }

  return { ok: true, dir: root, cleanup };
}

/**
 * Fetch a source into a staging directory.
 *
 * The caller owns the returned `cleanup` and must call it — the adapter copies
 * out of this directory, and nothing else should outlive that copy.
 */
export async function fetchSkillSource(source: SkillSource): Promise<FetchResult> {
  try {
    return source.kind === "git"
      ? await fetchGit(source)
      : await fetchUpload(source.files);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "could not fetch that skill",
    };
  }
}
