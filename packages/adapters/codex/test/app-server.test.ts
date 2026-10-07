import assert from "node:assert/strict";
import { it } from "node:test";
import { AppServer } from "../src/app-server.js";

const fake = `
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
  const frame = JSON.parse(line);
  const send = obj => process.stdout.write(JSON.stringify(obj)+'\\n');
  if (frame.method === 'initialize') return send({id:frame.id,result:{userAgent:'codex/0.160.1'}});
  if (frame.method === 'initialized') return;
  if (frame.method === 'fail') return send({id:frame.id,error:{message:'secret device code'}});
  if (frame.method === 'invalid') return process.stdout.write('invalid\\n');
  if (frame.method === 'hang') return;
  if (frame.method === 'notify') send({method:'account/updated',params:{authMode:'chatgpt'}});
  setTimeout(() => send({id:frame.id,result:frame.params}), frame.params.delay || 0);
});
`;

it("initializes, matches out-of-order replies, and forwards notifications", async () => {
  const client = new AppServer({ file: process.execPath, args: ["-e", fake] });
  try {
    await client.initialize();
    const notifications: string[] = [];
    client.onNotification((n) => notifications.push(n.method));
    const results = await Promise.all([
      client.request("echo", { delay: 20, value: 1 }),
      client.request("notify", { value: 2 }),
    ]);
    assert.deepEqual(results, [{ delay: 20, value: 1 }, { value: 2 }]);
    assert.deepEqual(notifications, ["account/updated"]);
    await assert.rejects(
      client.request("fail"),
      (error: Error) => error.message === "Codex App Server request failed",
    );
  } finally {
    await client.close();
  }
});

it("rejects malformed protocol and reaps the child", async () => {
  const client = new AppServer({ file: process.execPath, args: ["-e", fake] });
  await client.initialize();
  await assert.rejects(client.request("invalid"), /Invalid Codex/);
  await client.close();
});

it("kills a nonresponsive child at the absolute deadline", async () => {
  const client = new AppServer({
    file: process.execPath,
    args: ["-e", fake],
    timeoutMs: 150,
  });
  await client.initialize();
  await assert.rejects(client.request("hang"), /timed out/);
  await client.close();
});

it("handles a missing executable without exposing its raw error", async () => {
  const client = new AppServer({ file: "/no-such-codex" });
  await assert.rejects(client.initialize(), /could not start/);
  await client.close();
});
