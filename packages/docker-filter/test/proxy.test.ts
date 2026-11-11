import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
} from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Denied } from "../src/policy.ts";
import { resolveBindSource } from "../src/resolve.ts";
import { createFilter } from "../src/server.ts";

/** A stand-in daemon on a unix socket that records what reached it. */
interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

const dir = mkdtempSync(join(tmpdir(), "docker-filter-"));
const socket = join(dir, "docker.sock");
const seen: Seen[] = [];
let daemon: Server;
let filter: Server;
let port: number;
const daemonSockets = new Set<Socket>();

before(async () => {
  daemon = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"Id":"abc"}');
    });
  });
  // The daemon upgrades exec start, and declines everything else.
  daemon.on("upgrade", (req, client, head) => {
    if (!req.url?.endsWith("/start")) {
      client.end(
        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n" +
          'Content-Length: 16\r\n\r\n{"message":"no"}',
      );
      return;
    }
    client.write(
      "HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n",
    );
    // Echo, so a test can see both directions of the raw stream.
    if (head.length > 0) client.write(`body:${head.toString("utf8")}|`);
    client.on("data", (chunk: Buffer) =>
      client.write(`echo:${chunk.toString("utf8")}`),
    );
    // Like the daemon: once the client has nothing more to say, finish.
    client.on("end", () => client.end());
  });
  // An upgraded socket is no longer the server's to close; keep track.
  daemon.on("connection", (conn) => daemonSockets.add(conn));
  await new Promise<void>((done) => daemon.listen(socket, done));

  filter = createFilter({
    upstream: socket,
    policy: { bindRoots: ["/workspace"], resolve: (path) => path },
  });
  await new Promise<void>((done) => filter.listen(0, "127.0.0.1", done));
  port = (filter.address() as AddressInfo).port;
});

after(() => {
  filter.close();
  for (const conn of daemonSockets) conn.destroy();
  daemon.close();
  rmSync(dir, { recursive: true, force: true });
});

function call(
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      // No keep-alive: a pooled socket would hold the test process open.
      { port, host: "127.0.0.1", method, path, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** Speak raw HTTP, for what a well-behaved client would never send. */
function raw(payload: string, settle = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = connect(port, "127.0.0.1");
    let received = "";
    client.on("data", (chunk: Buffer) => (received += chunk.toString("utf8")));
    client.on("error", reject);
    client.on("close", () => resolve(received));
    client.write(payload);
    setTimeout(() => client.destroy(), settle);
  });
}

describe("proxy", () => {
  it("passes a read through with its query", async () => {
    seen.length = 0;
    const res = await call("GET", "/v1.51/containers/json?all=1");
    assert.equal(res.status, 200);
    assert.equal(seen[0]?.url, "/v1.51/containers/json?all=1");
  });

  it("re-issues an allowed create as the body it read", async () => {
    seen.length = 0;
    // The same key twice: whatever is checked must be what is sent.
    const res = await call(
      "POST",
      "/v1.51/containers/create",
      '{"Image":"a","HostConfig":{"Privileged":true},"HostConfig":{"Binds":["/workspace/p:/app"]}}',
    );
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {
      Image: "a",
      HostConfig: { Binds: ["/workspace/p:/app"] },
    });
    assert.equal(
      seen[0]?.headers["content-length"],
      String(Buffer.byteLength(seen[0]?.body ?? "")),
    );
  });

  it("answers a refused create itself, in the daemon's error shape", async () => {
    seen.length = 0;
    const res = await call(
      "POST",
      "/v1.51/containers/create",
      '{"Image":"a","HostConfig":{"Privileged":true}}',
    );
    assert.equal(res.status, 403);
    assert.match(JSON.parse(res.body).message, /Docker filter: privileged/);
    assert.equal(seen.length, 0);
  });

  it("refuses a body it cannot read and a request off the list", async () => {
    seen.length = 0;
    assert.equal((await call("POST", "/containers/create", "{")).status, 400);
    assert.equal((await call("POST", "/v1.51/plugins/pull")).status, 403);
    assert.equal(seen.length, 0);
  });

  it("says so when the sidecar is not there", async () => {
    const lonely = createFilter({
      upstream: join(dir, "missing.sock"),
      policy: { bindRoots: ["/workspace"], resolve: (path) => path },
    });
    await new Promise<void>((done) => lonely.listen(0, "127.0.0.1", done));
    const { port: lonelyPort } = lonely.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      request(
        { port: lonelyPort, host: "127.0.0.1", path: "/_ping", agent: false },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on("error", reject)
        .end();
    });
    lonely.close();
    assert.equal(status, 502);
  });

  it("hands over a connection the daemon upgraded, body first", async () => {
    const out = await raw(
      "POST /v1.51/exec/abc/start HTTP/1.1\r\nHost: docker\r\n" +
        "Connection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 14\r\n\r\n" +
        '{"Tty":true}  typed',
    );
    assert.match(out, /^HTTP\/1\.1 101 UPGRADED/);
    assert.match(out, /echo:typed/);
  });

  it("does not hand over a connection the daemon declined", async () => {
    seen.length = 0;
    // An upgrade the daemon turns down, then a second request on the same
    // connection: the second one must reach nobody.
    const out = await raw(
      "POST /v1.51/containers/abc/attach HTTP/1.1\r\nHost: docker\r\n" +
        "Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n" +
        "POST /v1.51/containers/create HTTP/1.1\r\nHost: docker\r\n" +
        'Content-Length: 46\r\n\r\n{"Image":"a","HostConfig":{"Privileged":true}}',
    );
    assert.match(out, /^HTTP\/1\.1 404 /);
    assert.match(out, /Connection: close/);
    assert.equal(seen.length, 0);
  });

  it("refuses an upgrade on a request that never hijacks", async () => {
    seen.length = 0;
    const out = await raw(
      "GET /_ping HTTP/1.1\r\nHost: docker\r\n" +
        "Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n",
    );
    assert.match(out, /^HTTP\/1\.1 403 /);
    assert.equal(seen.length, 0);
  });
});

describe("proxy teardown", () => {
  it("leaves no connection open once its clients have gone", async () => {
    await new Promise((done) => setTimeout(done, 100));
    const open = await new Promise<number>((resolve, reject) =>
      filter.getConnections((error, count) =>
        error ? reject(error) : resolve(count),
      ),
    );
    assert.equal(open, 0);
  });
});

describe("resolveBindSource", () => {
  const root = mkdtempSync(join(tmpdir(), "docker-filter-fs-"));
  mkdirSync(join(root, "project", "src"), { recursive: true });
  symlinkSync("/", join(root, "project", "escape"));
  symlinkSync(join(root, "project", "src"), join(root, "project", "inside"));
  symlinkSync("/no/such/place", join(root, "project", "dangling"));
  after(() => rmSync(root, { recursive: true, force: true }));

  // macOS and some CI tmpdirs are themselves behind a link.
  const real = resolveBindSource(root);

  it("resolves what exists and keeps what does not yet", () => {
    assert.equal(
      resolveBindSource(join(root, "project/src")),
      `${real}/project/src`,
    );
    assert.equal(
      resolveBindSource(join(root, "project/new/deeper")),
      `${real}/project/new/deeper`,
    );
  });

  it("follows links to where they lead", () => {
    assert.equal(resolveBindSource(join(root, "project/escape/etc")), "/etc");
    assert.equal(
      resolveBindSource(join(root, "project/inside")),
      `${real}/project/src`,
    );
  });

  it("refuses a link whose target it cannot see", () => {
    for (const path of ["project/dangling", "project/dangling/below"]) {
      assert.throws(
        () => resolveBindSource(join(root, path)),
        (error) => error instanceof Denied,
      );
    }
  });
});
