import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitRemoteHost } from "@overseer/protocol";

/**
 * The container's git ssh key.
 *
 * **Generated here, never uploaded.** The operator presses a button, the
 * container makes a keypair, and only the *public* half ever leaves — there is
 * no message in the protocol that returns the private key and no code path
 * that reads it. A key pasted in through a browser would have to cross the
 * network, sit in a form field, and land in whatever the browser remembers;
 * generating in place avoids all three.
 *
 * **Where it lives.** `$HOME/.ssh`, on the container-owned `agent-home`
 * volume. That is the one location every git in the container finds on its
 * own: the server's own operations, the agent's `git push` inside a session,
 * and anything typed into a console alike. Putting it anywhere else would mean
 * threading `GIT_SSH_COMMAND` through every spawn point and still missing the
 * ones the agent invents. It also puts the key under exactly the trust
 * boundary architecture §2/§6.2 already describes for provider auth — and
 * `./bin/reset`, which discards that volume, discards this with it.
 *
 * **No passphrase.** There is no ssh-agent in the container and nobody present
 * to type one when a background agent pushes at 3am, so a passphrase would
 * only move the secret to a second place that also has to be stored. The key's
 * protection is the volume boundary — the same one already holding every
 * provider's subscription token, which §6's threat model states plainly.
 *
 * **Host keys** are trusted on first use (`StrictHostKeyChecking accept-new`)
 * and pinned in `known_hosts` from then on. `accept-new` is not `no`: a host
 * whose key *changes* is still refused, which is the attack that matters after
 * enrolment. Baking forge host keys into the image was rejected — they rotate
 * (GitHub's RSA key in 2023), and it would cover only the public forges, not
 * the self-hosted ones this is mostly for.
 */

const KEY_NAME = "id_ed25519";

/** Long enough for a slow forge, short enough that a wedged connection does
 * not hold the single-flight lock open. */
const SSH_TIMEOUT_MS = 20_000;
const KEYGEN_TIMEOUT_MS = 15_000;

export interface SshKeyState {
  key?: { publicKey: string; fingerprint: string; createdAt: string };
  /** False when a key exists but ssh will refuse it — see `readPermissions`. */
  permissionsOk: boolean;
}

export interface SshTestResult {
  host: string;
  ok: boolean;
  account?: string;
  hostFingerprint?: string;
  message: string;
}

/** A completed process, whatever its exit code — `ssh -T` answers with a
 * non-zero code on success, so a runner that throws on one is unusable here. */
export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface GitSshDeps {
  run?: (
    file: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<RunResult>;
  sshDir?: string;
}

function defaultSshDir(): string {
  return (
    process.env.OVERSEER_SSH_DIR ??
    path.join(process.env.HOME ?? "/home/overseer", ".ssh")
  );
}

function defaultRun(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error
              ? null
              : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
  });
}

/**
 * The `SHA256:…` token out of ssh-keygen output, found by prefix rather than
 * by column. The two commands that print one disagree about where it sits:
 *
 *   ssh-keygen -lf key.pub   →  256 SHA256:abc… overseer (ED25519)
 *   ssh-keygen -F host -l …  →  github.com ED25519 SHA256:abc…
 *
 * Taking a fixed index reads the algorithm name as the fingerprint for the
 * second one, which is exactly what it did before this existed.
 */
function hashToken(stdout: string): string | undefined {
  return stdout.split(/\s+/).find((token) => token.startsWith("SHA256:"));
}

export function createGitSsh(deps: GitSshDeps = {}) {
  const run = deps.run ?? defaultRun;
  const dir = deps.sshDir ?? defaultSshDir();
  const keyPath = path.join(dir, KEY_NAME);
  const pubPath = `${keyPath}.pub`;
  const configPath = path.join(dir, "config");
  const knownHostsPath = path.join(dir, "known_hosts");

  /** One generate/remove at a time. Two tabs pressing the same button must not
   * race a keypair against its own deletion. */
  let inFlight: Promise<unknown> | undefined;
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = (inFlight ?? Promise.resolve()).then(work, work);
    inFlight = next.catch(() => undefined);
    return next;
  }

  /**
   * Whether ssh would actually accept what is on disk.
   *
   * Not a formality: `agent-home` outlives image rebuilds, so a key written
   * under one host uid is still there after the operator's uid changes, owned
   * by a user this container is not. ssh refuses a private key that is group-
   * or world-readable, and the failure it prints ("bad permissions") is far
   * from the panel the operator would need to open. Checking here lets the
   * panel say the key is unusable and offer to make a new one.
   */
  async function readPermissions(): Promise<boolean> {
    try {
      const entry = await stat(keyPath);
      // Owner-only. 0o077 catches every group and other bit at once.
      if ((entry.mode & 0o077) !== 0) return false;
      // Readable by this process at all — an EACCES here is the uid mismatch.
      await readFile(keyPath);
      return true;
    } catch {
      return false;
    }
  }

  async function status(): Promise<SshKeyState> {
    let publicKey: string;
    let createdAt: string;
    try {
      publicKey = (await readFile(pubPath, "utf8")).trim();
      createdAt = (await stat(pubPath)).mtime.toISOString();
    } catch {
      return { permissionsOk: true };
    }
    if (publicKey.length === 0) return { permissionsOk: false };

    return {
      key: { publicKey, fingerprint: await fingerprint(), createdAt },
      permissionsOk: await readPermissions(),
    };
  }

  async function fingerprint(): Promise<string> {
    const { stdout, code } = await run(
      "ssh-keygen",
      ["-lf", pubPath],
      KEYGEN_TIMEOUT_MS,
    );
    if (code !== 0) return "unknown";
    return hashToken(stdout) ?? "unknown";
  }

  async function generate(): Promise<
    { ok: true; state: SshKeyState } | { ok: false; reason: string }
  > {
    return serialized(async () => {
      if ((await status()).key) {
        return {
          ok: false as const,
          reason: "a key already exists — remove it first",
        };
      }

      // `mode` on mkdir is masked by the umask, so set it explicitly after.
      // ssh refuses to use a key under a group-writable directory.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);

      const { stderr, code } = await run(
        "ssh-keygen",
        ["-t", "ed25519", "-N", "", "-C", "overseer", "-f", keyPath, "-q"],
        KEYGEN_TIMEOUT_MS,
      );
      if (code !== 0) {
        return {
          ok: false as const,
          reason: stderr.trim().split("\n")[0] ?? "could not generate a key",
        };
      }

      await chmod(keyPath, 0o600);
      await chmod(pubPath, 0o644).catch(() => undefined);
      await writeConfig();

      return { ok: true as const, state: await status() };
    });
  }

  /**
   * Overseer owns this file outright, so it is rewritten rather than merged —
   * a half-understood edit is worse than a known-good replacement, and every
   * value in it is one this module is responsible for.
   */
  async function writeConfig(): Promise<void> {
    const body = [
      "# Written by overseer. Edits are replaced when the key is regenerated.",
      "Host *",
      `  IdentityFile ${keyPath}`,
      // Without this, ssh offers every key it can find and can exhaust the
      // server's limit on auth attempts before reaching the right one.
      "  IdentitiesOnly yes",
      // Trust on first use, but still refuse a host whose key changed.
      "  StrictHostKeyChecking accept-new",
      `  UserKnownHostsFile ${knownHostsPath}`,
      "",
    ].join("\n");
    await writeFile(configPath, body, { mode: 0o600 });
    await chmod(configPath, 0o600);
  }

  /**
   * Prove the key was added on `host` by authenticating against it.
   *
   * The exit code is *not* the answer. A successful `ssh -T git@github.com`
   * exits **1** — it authenticates and then reports that shell access is not
   * provided. Classifying on the text is the only correct reading, and it is
   * why this uses a runner that reports the code instead of throwing on it.
   */
  async function test(host: string, port?: number): Promise<SshTestResult> {
    const target = `git@${host}`;
    const args = [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-F",
      configPath,
      ...(port !== undefined ? ["-p", String(port)] : []),
      target,
    ];
    const { stdout, stderr } = await run("ssh", args, SSH_TIMEOUT_MS);
    const said = `${stdout}\n${stderr}`;

    const hostFingerprint = await knownHostFingerprint(host);
    const found = (message: string, ok: boolean, account?: string) => ({
      host,
      ok,
      message,
      ...(account !== undefined ? { account } : {}),
      ...(hostFingerprint !== undefined ? { hostFingerprint } : {}),
    });

    // GitHub: "Hi octocat! You've successfully authenticated…"
    // GitLab: "Welcome to GitLab, @octocat!"
    const greeted =
      said.match(/\bHi\s+([^!\s]+)!/)?.[1] ??
      said.match(/Welcome to GitLab,\s*@?([^!\s]+)!/)?.[1];
    if (greeted !== undefined || /successfully authenticated/i.test(said)) {
      return found(
        greeted !== undefined
          ? `authenticated as ${greeted}`
          : "authenticated",
        true,
        greeted,
      );
    }
    if (/permission denied \(publickey\)/i.test(said)) {
      return found(
        "the host refused this key — add the public key there, then test again",
        false,
      );
    }
    if (/host key verification failed/i.test(said)) {
      return found(
        "the host's key changed since it was first trusted — nothing was sent",
        false,
      );
    }
    if (/could not resolve hostname|name or service not known/i.test(said)) {
      return found("no such host", false);
    }
    if (/connection timed out|operation timed out|connection refused/i.test(said)) {
      return found("could not reach the host", false);
    }
    return found(
      stderr.trim().split("\n").filter(Boolean).pop() ?? "could not connect",
      false,
    );
  }

  /** The pinned fingerprint for a host, so the operator can compare it with
   * the one the forge publishes. Absent until something has connected. */
  async function knownHostFingerprint(host: string): Promise<string | undefined> {
    const { stdout, code } = await run(
      "ssh-keygen",
      ["-F", host, "-l", "-f", knownHostsPath],
      KEYGEN_TIMEOUT_MS,
    );
    if (code !== 0) return undefined;
    return hashToken(stdout);
  }

  /**
   * Delete the keypair. `known_hosts` and `config` deliberately survive: the
   * host pins are still correct for the next key, and throwing them away would
   * silently re-open the first-use window this module just closed.
   */
  async function remove(): Promise<void> {
    return serialized(async () => {
      await unlink(keyPath).catch(() => undefined);
      await unlink(pubPath).catch(() => undefined);
    });
  }

  return { status, generate, test, remove };
}

/**
 * The host a git remote points at, or undefined when it is not ssh.
 *
 * Both spellings have to parse, because both are in ordinary use:
 *   scp-style   git@github.com:owner/repo.git
 *               git@[2001:db8::1]:repos/x.git
 *   url-style   ssh://git@gitlab.example:2424/group/repo.git
 *
 * An `https://` remote returns undefined rather than a host: the key does not
 * apply to it, and offering it as a test target would be a lie.
 */
export function parseRemoteHost(url: string): GitRemoteHost | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) return undefined;

  if (/^ssh:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname;
      if (host.length === 0) return undefined;
      const port = parsed.port === "" ? undefined : Number(parsed.port);
      // `URL` strips the brackets off an IPv6 literal; put them back so the
      // value round-trips through the protocol's own host guard.
      const named = parsed.hostname.includes(":") ? `[${host}]` : host;
      return port === undefined ? { host: named } : { host: named, port };
    } catch {
      return undefined;
    }
  }

  // Anything with a scheme that is not ssh (https, git, file) is not ours.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;

  // scp-style: [user@]host:path — the colon before the path, not inside a
  // bracketed literal.
  const afterUser = trimmed.slice(trimmed.indexOf("@") + 1);
  if (afterUser.startsWith("[")) {
    const close = afterUser.indexOf("]");
    if (close === -1 || afterUser[close + 1] !== ":") return undefined;
    return { host: afterUser.slice(0, close + 1) };
  }
  const colon = afterUser.indexOf(":");
  if (colon <= 0) return undefined;
  return { host: afterUser.slice(0, colon) };
}

/** The instance `ws.ts` uses. */
export const gitSsh = createGitSsh();
