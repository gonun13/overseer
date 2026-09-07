import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { createGitSsh, parseRemoteHost, type RunResult } from "../src/vcs/ssh.js";

/** A `run` fake answering a script keyed by the binary and first argument,
 * recording every argv — the same DI shape `project-git.test.ts` uses. */
function scriptedRun(
  answer: (file: string, args: string[]) => Partial<RunResult>,
) {
  return mock.fn(async (file: string, args: string[]): Promise<RunResult> => {
    const given = answer(file, args);
    return {
      stdout: given.stdout ?? "",
      stderr: given.stderr ?? "",
      code: given.code ?? 0,
    };
  });
}

async function scratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "overseer-ssh-"));
}

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyBytes overseer";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nSUPERSECRET\n-----END-----\n";

describe("git ssh key store", () => {
  it("reports no key on an empty directory", async () => {
    const ssh = createGitSsh({ sshDir: await scratchDir(), run: scriptedRun(() => ({})) });
    const state = await ssh.status();
    assert.equal(state.key, undefined);
    assert.equal(state.permissionsOk, true);
  });

  it("generates with an empty passphrase and locks the files down", async () => {
    const dir = path.join(await scratchDir(), "nested");
    const run = scriptedRun((file, args) => {
      if (file === "ssh-keygen" && args[0] === "-lf") {
        return { stdout: "256 SHA256:FINGERPRINT overseer (ED25519)\n" };
      }
      return {};
    });
    const ssh = createGitSsh({ sshDir: dir, run });

    // ssh-keygen is faked, so stand in the files it would have written.
    const original = run.mock.mockImplementation;
    void original;
    run.mock.mockImplementation(async (file: string, args: string[]) => {
      if (file === "ssh-keygen" && args.includes("-t")) {
        const target = args[args.indexOf("-f") + 1]!;
        await writeFile(target, PRIVATE_KEY, { mode: 0o600 });
        await writeFile(`${target}.pub`, `${PUBLIC_KEY}\n`);
        return { stdout: "", stderr: "", code: 0 };
      }
      if (file === "ssh-keygen" && args[0] === "-lf") {
        return { stdout: "256 SHA256:FINGERPRINT overseer (ED25519)\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });

    const result = await ssh.generate();
    assert.equal(result.ok, true);

    const keygen = run.mock.calls
      .map((call) => call.arguments)
      .find(([file, args]) => file === "ssh-keygen" && (args as string[]).includes("-t"));
    assert.deepEqual(keygen?.[1], [
      "-t", "ed25519", "-N", "", "-C", "overseer",
      "-f", path.join(dir, "id_ed25519"), "-q",
    ]);

    // 0700 dir / 0600 key, or ssh refuses to use the key at all.
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(dir, "id_ed25519"))).mode & 0o077, 0);

    const config = await readFile(path.join(dir, "config"), "utf8");
    assert.match(config, /IdentitiesOnly yes/);
    assert.match(config, /StrictHostKeyChecking accept-new/);
  });

  it("refuses to overwrite an existing key", async () => {
    const dir = await scratchDir();
    await writeFile(path.join(dir, "id_ed25519.pub"), `${PUBLIC_KEY}\n`);
    const run = scriptedRun(() => ({ stdout: "256 SHA256:F x (ED25519)\n" }));
    const ssh = createGitSsh({ sshDir: dir, run });

    const result = await ssh.generate();
    assert.equal(result.ok, false);
    assert.equal(
      run.mock.calls.some((call) =>
        (call.arguments[1] as string[]).includes("-t"),
      ),
      false,
      "must not run ssh-keygen when a key is already present",
    );
  });

  it("never returns the private key", async () => {
    const dir = await scratchDir();
    await writeFile(path.join(dir, "id_ed25519"), PRIVATE_KEY, { mode: 0o600 });
    await writeFile(path.join(dir, "id_ed25519.pub"), `${PUBLIC_KEY}\n`);
    const ssh = createGitSsh({
      sshDir: dir,
      run: scriptedRun(() => ({ stdout: "256 SHA256:F x (ED25519)\n" })),
    });

    const serialized = JSON.stringify(await ssh.status());
    assert.equal(serialized.includes("SUPERSECRET"), false);
    assert.equal(serialized.includes("PRIVATE KEY"), false);
    assert.match(serialized, /ssh-ed25519 /);
  });

  it("reports permissionsOk false for a group-readable key", async () => {
    const dir = await scratchDir();
    await writeFile(path.join(dir, "id_ed25519"), PRIVATE_KEY, { mode: 0o644 });
    await writeFile(path.join(dir, "id_ed25519.pub"), `${PUBLIC_KEY}\n`);
    const ssh = createGitSsh({
      sshDir: dir,
      run: scriptedRun(() => ({ stdout: "256 SHA256:F x (ED25519)\n" })),
    });

    const state = await ssh.status();
    assert.ok(state.key, "the key is still there");
    assert.equal(state.permissionsOk, false);
  });

  it("removes the keypair but keeps known_hosts", async () => {
    const dir = await scratchDir();
    await writeFile(path.join(dir, "id_ed25519"), PRIVATE_KEY, { mode: 0o600 });
    await writeFile(path.join(dir, "id_ed25519.pub"), `${PUBLIC_KEY}\n`);
    await writeFile(path.join(dir, "known_hosts"), "github.com ssh-ed25519 AAAA\n");
    const ssh = createGitSsh({ sshDir: dir, run: scriptedRun(() => ({})) });

    await ssh.remove();
    assert.equal((await ssh.status()).key, undefined);
    await stat(path.join(dir, "known_hosts")); // throws if it was deleted
  });
});

describe("git ssh connection test", () => {
  const testWith = async (stdout: string, stderr: string, code: number | null) => {
    const dir = await scratchDir();
    await mkdir(dir, { recursive: true });
    const ssh = createGitSsh({
      sshDir: dir,
      run: scriptedRun((file) =>
        file === "ssh" ? { stdout, stderr, code } : { code: 1 },
      ),
    });
    return ssh.test("github.com");
  };

  it("treats github's exit-1 greeting as success", async () => {
    // The trap this whole path exists for: ssh -T authenticates and then
    // exits non-zero because the forge provides no shell.
    const result = await testWith(
      "",
      "Hi octocat! You've successfully authenticated, but GitHub does not provide shell access.\n",
      1,
    );
    assert.equal(result.ok, true);
    assert.equal(result.account, "octocat");
    assert.match(result.message, /authenticated as octocat/);
  });

  it("reads gitlab's greeting too", async () => {
    const result = await testWith("", "Welcome to GitLab, @octocat!\n", 1);
    assert.equal(result.ok, true);
    assert.equal(result.account, "octocat");
  });

  it("classifies a refused key as not-yet-added", async () => {
    const result = await testWith("", "git@github.com: Permission denied (publickey).\n", 255);
    assert.equal(result.ok, false);
    assert.match(result.message, /add the public key/);
  });

  it("classifies a changed host key without claiming anything was sent", async () => {
    const result = await testWith("", "Host key verification failed.\n", 255);
    assert.equal(result.ok, false);
    assert.match(result.message, /nothing was sent/);
  });

  it("classifies an unreachable host", async () => {
    const result = await testWith("", "ssh: connect to host x port 22: Connection timed out\n", 255);
    assert.equal(result.ok, false);
    assert.match(result.message, /could not reach/);
  });

  it("reads the host fingerprint out of ssh-keygen -F, not the algorithm name", async () => {
    // The two ssh-keygen commands put the SHA256 token in different columns:
    //   -lf key.pub  →  "256 SHA256:… overseer (ED25519)"
    //   -F host -l   →  "github.com ED25519 SHA256:…"
    // Indexing by column read "ED25519" as the fingerprint here.
    const dir = await scratchDir();
    const ssh = createGitSsh({
      sshDir: dir,
      run: scriptedRun((file, args) => {
        if (file === "ssh") return { stderr: "Hi octocat!\n", code: 1 };
        if (args[0] === "-F") {
          return {
            stdout:
              "# Host github.com found: line 1 \ngithub.com ED25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU\n",
          };
        }
        return {};
      }),
    });

    const result = await ssh.test("github.com");
    assert.equal(
      result.hostFingerprint,
      "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
    );
  });

  it("passes a non-default port through to ssh", async () => {
    const dir = await scratchDir();
    const run = scriptedRun((file) =>
      file === "ssh" ? { stderr: "Welcome to GitLab, @ng!\n", code: 1 } : { code: 1 },
    );
    const ssh = createGitSsh({ sshDir: dir, run });
    await ssh.test("gitlab.local", 2424);

    const argv = run.mock.calls
      .map((call) => call.arguments)
      .find(([file]) => file === "ssh")?.[1] as string[];
    assert.ok(argv.includes("-p"));
    assert.equal(argv[argv.indexOf("-p") + 1], "2424");
    assert.equal(argv.at(-1), "git@gitlab.local");
  });
});

describe("parseRemoteHost", () => {
  it("reads the shapes this workspace actually uses", () => {
    assert.deepEqual(parseRemoteHost("git@github.com:gonun13/overseer.git"), {
      host: "github.com",
    });
    assert.deepEqual(
      parseRemoteHost("ssh://git@gitlab.local:2424/nuno-gomes/otm.git"),
      { host: "gitlab.local", port: 2424 },
    );
    assert.deepEqual(
      parseRemoteHost("git@[2001:bc8:1d90:1f48:dc00:ff:fe2b:14e1]:repos/gonun13.git"),
      { host: "[2001:bc8:1d90:1f48:dc00:ff:fe2b:14e1]" },
    );
  });

  it("returns nothing for an https remote — the key does not apply to it", () => {
    assert.equal(parseRemoteHost("https://github.com/gonun13/json-timesync.git"), undefined);
    assert.equal(parseRemoteHost("git://example.com/x.git"), undefined);
  });

  it("returns nothing for junk", () => {
    assert.equal(parseRemoteHost(""), undefined);
    assert.equal(parseRemoteHost("   "), undefined);
    assert.equal(parseRemoteHost("not-a-remote"), undefined);
  });
});
