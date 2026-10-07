import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import type { AuthStateMessage } from "@overseer/protocol";
import {
  cancelLogin,
  currentAuthState,
  startLogin,
  submitCode,
} from "../src/login.js";
import { writeSnapshot } from "../src/memory/internal.js";

it("the shared broker replays the full Codex device flow and keeps grants out of memory logs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "overseer-codex-broker-"));
  const oldPath = process.env.PATH;
  const oldMemory = process.env.OVERSEER_INTERNAL_DIR;
  const fake = `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const f=JSON.parse(line); const send=result=>process.stdout.write(JSON.stringify({id:f.id,result})+'\\n');
  if(f.method==='initialize') send({});
  if(f.method==='account/read') send({account:null,requiresOpenaiAuth:true});
  if(f.method==='account/login/start') send({type:'chatgptDeviceCode',loginId:'fixture-login',verificationUrl:'https://auth.openai.com/codex/device?fixture=broker',userCode:'TEST-1234'});
  if(f.method==='account/login/cancel') send({});
});
`;
  await writeFile(path.join(root, "codex"), fake);
  await chmod(path.join(root, "codex"), 0o755);
  process.env.PATH = `${root}:${oldPath}`;
  process.env.OVERSEER_INTERNAL_DIR = root;
  const frames: AuthStateMessage[] = [];
  const waitFor = async (phase: string) => {
    const deadline = Date.now() + 5000;
    while (!frames.some((f) => f.phase === phase)) {
      if (Date.now() > deadline) throw new Error(`missing auth phase ${phase}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return frames.find((f) => f.phase === phase)!;
  };
  try {
    await writeSnapshot({
      runCount: 1,
      workspaceRoot: "/workspace",
      projects: [],
      providers: [
        {
          id: "codex",
          login: true,
          usageCheck: true,
          status: { authenticated: false },
        },
      ],
    });
    const record = (frame: AuthStateMessage) => frames.push(frame);
    assert.deepEqual(
      startLogin("codex", record, () => {}),
      { ok: true },
    );
    const instructions = await waitFor("awaiting-browser");
    const replayed: AuthStateMessage[] = [];
    assert.deepEqual(
      startLogin("codex", record, (frame) => replayed.push(frame)),
      { ok: true },
    );
    assert.deepEqual(replayed, [instructions]);
    assert.deepEqual(submitCode("ignored"), {
      ok: false,
      reason: "enter the device code in your browser",
    });
    assert.equal(currentAuthState()?.userCode, "TEST-1234");
    assert.equal(
      currentAuthState()?.verificationUrl,
      instructions.verificationUrl,
    );
    cancelLogin();
    await waitFor("failed");
    // Let the broker's asynchronous action bookkeeping land.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const logs = await readFile(path.join(root, "actions.jsonl"), "utf8");
    assert.ok(!logs.includes("TEST-1234"));
    assert.ok(!logs.includes("auth.openai.com"));
  } finally {
    cancelLogin();
    process.env.PATH = oldPath;
    if (oldMemory === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
    else process.env.OVERSEER_INTERNAL_DIR = oldMemory;
    await rm(root, { recursive: true, force: true });
  }
});
