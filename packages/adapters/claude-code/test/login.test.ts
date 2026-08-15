import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { LoginUpdate } from "@overseer/protocol";
import { readAuthStatus, startLogin } from "../src/login.js";

/**
 * These run the *real* driver against a stand-in `claude` on PATH that
 * reproduces what 2.1.226 actually does — the output was captured from the CLI
 * running in the dev container, not written from the docs.
 *
 * Reproduced faithfully, because each one is a trap the driver has to survive:
 *
 * - the URL line and the `Paste code here…` prompt arrive in **one write**,
 *   with no newline after the prompt, so a per-chunk scan misses the URL;
 * - a malformed paste writes `Invalid code.` and the process **keeps waiting**;
 * - SIGINT at the prompt exits **0**, exactly like a successful login.
 */

const URL_FIXTURE =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code" +
  "&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback" +
  "&code_challenge=WNI1z450PhoXxA6vWKNUY4SULtINEjZ66z4Y7Lrqdfs&code_challenge_method=S256" +
  "&state=jCQpuDvGYfNlr_zYn2oia7Xdeswt0m25XiLvrOvnqvA";

/** Where the stand-in writes what it was handed on stdin, byte for byte. */
let capture: string;
let binDir: string;
let originalPath: string | undefined;

/**
 * The stand-in. `auth status` answers logged-out (the state the container is
 * really in); `auth login` prints the browser line, the URL line and the prompt
 * in one write, then reads codes: anything without a `#` is refused the way the
 * CLI refuses it — on stderr, still alive — and anything with one is recorded
 * and accepted.
 */
// The apostrophe in "didn't" and the `%` escapes in the URL are both hostile to
// `sh` quoting, so the prompt is one `printf` with the URL as a `%s` argument
// out of the environment — which is also what keeps it a *single* write.
const FAKE_CLI = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.226 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 1
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  # STUBBORN reproduces the case the escalation exists for: a child that
  # installs a SIGINT handler and declines to die from it.
  if [ "$STUBBORN" = "1" ]; then trap '' INT; else trap 'exit 0' INT; fi
  printf 'Opening browser to sign in...\\nIf the browser didn'"'"'t open, visit: %s\\nPaste code here if prompted > ' "$LOGIN_URL"
  while IFS= read -r line; do
    printf '%s\\n' "$line" >> "$CAPTURE_FILE"
    case "$line" in
      *"#"*) exit 0 ;;
      *) printf '%s\\n' 'Invalid code. Please make sure the full code was copied.' >&2 ;;
    esac
  done
  exit 0
fi
exit 1
`;

before(async () => {
  binDir = await mkdtemp(path.join(tmpdir(), "overseer-cli-"));
  capture = path.join(binDir, "capture.txt");
  const file = path.join(binDir, "claude");
  await writeFile(file, FAKE_CLI, "utf8");
  await chmod(file, 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  process.env.CAPTURE_FILE = capture;
  process.env.LOGIN_URL = URL_FIXTURE;
});

after(() => {
  process.env.PATH = originalPath;
  delete process.env.CAPTURE_FILE;
  delete process.env.LOGIN_URL;
});

describe("readAuthStatus", () => {
  it("reads the JSON payload, not the exit code", async () => {
    // `auth status` exits 1 when logged out. That is a successful check with a
    // negative answer, and treating it as a failed check loses the version.
    const status = await readAuthStatus();
    assert.equal(status.authenticated, false);
    assert.equal(status.version, "2.1.226");
    assert.equal(status.detail, "not logged in");
    assert.notEqual(status.reachable, false);
  });

  it("marks the CLI unreachable when it is missing from PATH", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const status = await readAuthStatus();
      assert.equal(status.authenticated, false);
      assert.equal(status.reachable, false);
      assert.match(status.detail ?? "", /not found/i);
    } finally {
      process.env.PATH = previous;
    }
  });
});

describe("startLogin", () => {
  it("surfaces the verification URL byte-identically", async () => {
    const updates: LoginUpdate[] = [];
    const handle = startLogin((update) => updates.push(update));
    const url = await waitFor(updates, (u) => u.phase === "awaiting-code");
    assert.equal(url.verificationUrl, URL_FIXTURE);
    handle.cancel();
    await handle.done;
  });

  it("passes the code to stdin verbatim, `#state` intact", async () => {
    const updates: LoginUpdate[] = [];
    const handle = startLogin((update) => updates.push(update));
    await waitFor(updates, (u) => u.phase === "awaiting-code");

    // A real paste: the fragment is part of the credential, not a URL fragment.
    // Surrounding whitespace is the only thing the driver may remove.
    const pasted = "  Abc-123_XYZ#Zt0m25XiLvrOvnqvA  ";
    handle.submitCode(pasted);
    await handle.done;

    const written = await readFile(capture, "utf8");
    assert.ok(
      written.includes("Abc-123_XYZ#Zt0m25XiLvrOvnqvA"),
      `stdin got ${JSON.stringify(written)}`,
    );
    assert.ok(!written.includes("  Abc"), "surrounding whitespace should go");
  });

  it("keeps the flow alive after a refused code and accepts a second one", async () => {
    const updates: LoginUpdate[] = [];
    const handle = startLogin((update) => updates.push(update));
    await waitFor(updates, (u) => u.phase === "awaiting-code");

    handle.submitCode("nohashhere");
    const refused = await waitFor(
      updates,
      (u) => u.retryable === true && u.phase === "awaiting-code",
    );
    // The CLI's own words, and the URL still on screen — restarting the flow
    // here would invalidate the link the operator is holding.
    assert.match(refused.detail ?? "", /Invalid code\./);
    assert.equal(refused.verificationUrl, URL_FIXTURE);

    handle.submitCode("second#try");
    await handle.done;
    const written = await readFile(capture, "utf8");
    assert.ok(written.includes("second#try"));
  });

  it("never reads exit 0 as success", async () => {
    // Cancel exits 0, same as a completed login. The verdict comes from
    // re-asking `auth status`, which here still says logged out.
    const updates: LoginUpdate[] = [];
    const handle = startLogin((update) => updates.push(update));
    await waitFor(updates, (u) => u.phase === "awaiting-code");
    handle.cancel();
    const status = await handle.done;
    assert.equal(status.authenticated, false);
    const last = updates.at(-1);
    assert.equal(last?.phase, "failed");
    assert.equal(last?.detail, "login cancelled");
  });

  it("escalates to SIGKILL when the child ignores SIGINT", async () => {
    // Regression: `cancel()` used to send SIGINT and wait. A child that does
    // not honour it left `done` pending forever — and because the server frees
    // its single-flight slot on `done`, every later `auth.start` took the join
    // branch, replayed a dead frame, spawned nothing and reported success.
    // Login stayed broken for the life of the process, silently.
    process.env.STUBBORN = "1";
    try {
      const updates: LoginUpdate[] = [];
      const handle = startLogin((update) => updates.push(update), {
        killGraceMs: 300,
      });
      await waitFor(updates, (u) => u.phase === "awaiting-code");
      handle.cancel();
      // The assertion is simply that this resolves at all.
      const status = await handle.done;
      assert.equal(status.authenticated, false);
      assert.equal(updates.at(-1)?.phase, "failed");
    } finally {
      delete process.env.STUBBORN;
    }
  });

  it("settles `done` even when the update listener throws", async () => {
    // Regression: `onUpdate` is the server's broadcast → `ws.send`. It used to
    // run *before* `resolve`, inside an uncaught `.then`, so one throw from a
    // dead socket wedged the slot and raised an unhandled rejection.
    const handle = startLogin((update) => {
      if (update.phase === "failed" || update.phase === "success") {
        throw new Error("listener exploded");
      }
    });
    // Give it a moment to reach the prompt, then end it.
    await new Promise((r) => setTimeout(r, 200));
    handle.cancel();
    const status = await handle.done;
    assert.equal(status.authenticated, false);
  });

  it("never puts the URL or the code in a phase it does not belong in", async () => {
    // Log hygiene has to hold at the source: the only place the URL appears is
    // the field named for it, and the pasted code appears nowhere at all.
    const updates: LoginUpdate[] = [];
    const handle = startLogin((update) => updates.push(update));
    await waitFor(updates, (u) => u.phase === "awaiting-code");
    handle.submitCode("secret-code#secret-state");
    await handle.done;
    for (const update of updates) {
      assert.ok(!update.detail?.includes("secret-code"));
      assert.ok(!update.detail?.includes(URL_FIXTURE));
    }
  });
});

/** Resolves once an update matching `predicate` has arrived. */
function waitFor(
  updates: LoginUpdate[],
  predicate: (update: LoginUpdate) => boolean,
): Promise<LoginUpdate> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = () => {
      const found = updates.find(predicate);
      if (found !== undefined) {
        resolve(found);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`no update matched · saw ${JSON.stringify(updates)}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}
