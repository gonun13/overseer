import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AuthStateMessage } from "@overseer/protocol";
import {
  cancelLogin,
  currentAuthState,
  startLogin,
  submitCode,
} from "../src/login.js";
import { writeSnapshot } from "../src/memory/internal.js";

/**
 * The broker against the real `claude-code` adapter, with a stand-in `claude`
 * on PATH. Both failure modes covered here are silent — the operator sees a
 * button that does nothing and the server logs nothing — so neither would turn
 * up in manual testing.
 */

/** Prints the URL, then sits at the prompt until stdin closes or it is killed. */
const FAKE_CLI = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.226 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 1
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  trap 'exit 0' INT
  printf 'If the browser didn'"'"'t open, visit: %s\\nPaste code here if prompted > ' "$LOGIN_URL"
  while IFS= read -r line; do
    printf '%s\\n' 'Invalid code. Please make sure the full code was copied.' >&2
  done
  exit 0
fi
exit 1
`;

const URL_FIXTURE = "https://claude.com/cai/oauth/authorize?state=abc123";

let binDir: string;
let memoryDir: string;
let previousPath: string | undefined;
let previousMemory: string | undefined;

before(async () => {
  binDir = await mkdtemp(path.join(tmpdir(), "overseer-broker-cli-"));
  const file = path.join(binDir, "claude");
  await writeFile(file, FAKE_CLI, "utf8");
  await chmod(file, 0o755);

  previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  process.env.LOGIN_URL = URL_FIXTURE;

  // Internal memory goes to a temp dir — the broker writes the login outcome
  // into the world snapshot, and a test must not touch the real store.
  memoryDir = await mkdtemp(path.join(tmpdir(), "overseer-broker-mem-"));
  previousMemory = process.env.OVERSEER_INTERNAL_DIR;
  process.env.OVERSEER_INTERNAL_DIR = memoryDir;
  await writeSnapshot({
    runCount: 1,
    workspaceRoot: "/workspace",
    projects: [],
    adapters: [{ id: "claude-code", status: { authenticated: false } }],
  });
});

after(async () => {
  process.env.PATH = previousPath;
  delete process.env.LOGIN_URL;
  if (previousMemory === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
  else process.env.OVERSEER_INTERNAL_DIR = previousMemory;
  await rm(binDir, { recursive: true, force: true });
  await rm(memoryDir, { recursive: true, force: true });
});

/** Collects every broadcast frame, and lets a test await a particular one. */
function recorder() {
  const frames: AuthStateMessage[] = [];
  const broadcast = (frame: AuthStateMessage) => frames.push(frame);
  const waitFor = (predicate: (f: AuthStateMessage) => boolean) =>
    new Promise<AuthStateMessage>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const poll = () => {
        const found = frames.find(predicate);
        if (found !== undefined) return resolve(found);
        if (Date.now() > deadline) {
          return reject(new Error(`no frame matched · saw ${frames.length}`));
        }
        setTimeout(poll, 10);
      };
      poll();
    });
  return { frames, broadcast, waitFor };
}

const noop = () => {};

describe("login broker", () => {
  it("joins an in-flight login instead of spawning a second child", async () => {
    const { broadcast, waitFor } = recorder();
    const replayed: AuthStateMessage[] = [];

    assert.deepEqual(startLogin("claude-code", broadcast, noop), { ok: true });
    const first = await waitFor((f) => f.phase === "awaiting-code");

    // The second asker is replayed the running flow's state — same URL, since
    // the code the operator holds is only redeemable by the process that
    // printed it.
    assert.deepEqual(
      startLogin("claude-code", broadcast, (f) => replayed.push(f)),
      { ok: true },
    );
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0]?.verificationUrl, first.verificationUrl);
    assert.equal(replayed[0]?.phase, "awaiting-code");

    cancelLogin();
    await waitFor((f) => f.phase === "failed");
  });

  it("frees the slot on the terminal frame, not after its disk writes", async () => {
    // Regression: the failed/success frame is broadcast synchronously from the
    // child's `close` handler, but `live` used to be cleared only in `done`'s
    // `.finally` — after two awaited writes. The UI enables "try again" on
    // exactly that frame, so a click landed in the gap, took the join branch,
    // was replayed the dead frame and spawned nothing.
    const { broadcast, waitFor } = recorder();
    startLogin("claude-code", broadcast, noop);
    await waitFor((f) => f.phase === "awaiting-code");
    cancelLogin();

    const terminal = await waitFor((f) => f.phase === "failed");
    assert.equal(terminal.phase, "failed");

    // Retry in the same turn the terminal frame arrived in. This must start a
    // real login, which means a *new* URL and no replay.
    const retry = recorder();
    const replayed: AuthStateMessage[] = [];
    assert.deepEqual(
      startLogin("claude-code", retry.broadcast, (f) => replayed.push(f)),
      { ok: true },
    );
    assert.equal(replayed.length, 0, "a fresh start must not be a join");

    const fresh = await retry.waitFor((f) => f.phase === "awaiting-code");
    assert.equal(fresh.verificationUrl, URL_FIXTURE);

    cancelLogin();
    await retry.waitFor((f) => f.phase === "failed");
  });

  it("refuses a code and a cancel once no login is running", async () => {
    assert.deepEqual(submitCode("abc#def"), {
      ok: false,
      reason: "no login is running",
    });
    assert.deepEqual(cancelLogin(), {
      ok: false,
      reason: "no login is running",
    });
  });

  it("does not replay a failed login to a tab that arrives later", async () => {
    // A failure is transient: the tabs that were watching saw the reason, and
    // handing "login failed" to a socket that connects afterwards would report
    // a past event as the current state of the world.
    const state = currentAuthState();
    assert.equal(state, undefined);
  });
});
