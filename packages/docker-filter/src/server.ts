/**
 * The proxy: every Docker API request from a console arrives here, is decided
 * by policy.ts, and only then reaches the sidecar's socket.
 *
 * Requests are re-issued, never relayed as bytes: this process parses each
 * one and writes its own to the daemon, so the daemon never sees a request
 * this file did not read the same way. The one exception is a connection the
 * daemon has agreed to take over (attach, exec, a build's channels), which is
 * a raw stream from then on — and only once the daemon has said so.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import {
  Denied,
  inspectBody,
  route,
  type Inspector,
  type PolicyOptions,
} from "./policy.ts";

export interface FilterOptions {
  /** The sidecar daemon's unix socket. */
  readonly upstream: string;
  readonly policy: PolicyOptions;
  readonly log?: (line: string) => void;
}

/** Inspected bodies are container and volume specs — kilobytes, not this. */
const MAX_INSPECTED_BODY = 4 * 1024 * 1024;
/** A refused upgrade is a short error from the daemon, relayed whole. */
const MAX_RELAYED_ERROR = 1024 * 1024;

/** Headers that describe one connection and must not be carried to the next. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
]);

function forwardable(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] as string;
    if (!HOP_BY_HOP.has(name.toLowerCase()))
      out.push(name, raw[i + 1] as string);
  }
  return out;
}

function without(raw: readonly string[], names: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] as string;
    if (!names.includes(name.toLowerCase()))
      out.push(name, raw[i + 1] as string);
  }
  return out;
}

/** The shape the Docker CLI prints as `Error response from daemon: …`. */
function errorBody(message: string): Buffer {
  return Buffer.from(
    JSON.stringify({ message: `Overseer's Docker filter: ${message}` }),
  );
}

function unavailable(error: NodeJS.ErrnoException): string {
  return error.code === "ENOENT" || error.code === "ECONNREFUSED"
    ? "the Docker sidecar is not answering yet"
    : `the Docker sidecar could not be reached (${error.code ?? error.message})`;
}

export function createFilter(options: FilterOptions): Server {
  const log = options.log ?? (() => {});

  const refuse = (
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    message: string,
  ) => {
    log(`${status} ${req.method} ${req.url} — ${message}`);
    const body = errorBody(message);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": body.length,
      // The rest of this request is not read; do not reuse the connection.
      connection: "close",
    });
    res.end(body);
  };

  const forward = (
    req: IncomingMessage,
    res: ServerResponse,
    headers: string[],
    body: Buffer | undefined,
  ) => {
    const upstream = httpRequest({
      socketPath: options.upstream,
      method: req.method,
      path: req.url,
      headers,
      agent: false,
    });
    upstream.on("response", (reply) => {
      res.writeHead(
        reply.statusCode ?? 502,
        reply.statusMessage,
        forwardable(reply.rawHeaders),
      );
      // Logs, events and build output are streams: send what there is now.
      res.flushHeaders();
      reply.pipe(res);
      reply.on("error", () => res.destroy());
    });
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (res.headersSent) res.destroy();
      else refuse(req, res, 502, unavailable(error));
    });
    res.on("close", () => upstream.destroy());
    if (body !== undefined) upstream.end(body);
    else req.pipe(upstream);
  };

  const inspected = (
    req: IncomingMessage,
    res: ServerResponse,
    inspector: Inspector,
  ) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_INSPECTED_BODY) {
        done = true;
        refuse(req, res, 413, "the request body is too large to inspect");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      let checked: unknown;
      try {
        checked = inspectBody(
          inspector,
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
          options.policy,
        );
      } catch (error) {
        refuse(
          req,
          res,
          error instanceof Denied ? 403 : 400,
          error instanceof Denied
            ? error.message
            : "the request body is not valid JSON",
        );
        return;
      }
      const body = Buffer.from(JSON.stringify(checked));
      const headers = without(forwardable(req.rawHeaders), [
        "content-length",
        "transfer-encoding",
      ]);
      headers.push("Content-Length", String(body.length));
      forward(req, res, headers, body);
    });
  };

  const server = createServer((req, res) => {
    const decision = route(req.method ?? "", req.url ?? "");
    if (decision.kind === "deny") {
      refuse(req, res, 403, decision.reason);
    } else if (decision.kind === "inspect") {
      inspected(req, res, decision.inspector);
    } else {
      forward(req, res, forwardable(req.rawHeaders), undefined);
    }
  });

  server.on("upgrade", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    takeOver(req, client, head, options, log);
  });

  // A build context or an image load can take longer than Node's default
  // five minutes to arrive; slow is not the same as stuck.
  server.requestTimeout = 0;
  return server;
}

/**
 * Answer on a raw socket and let go of it. Nothing reads this socket any
 * more, so without the drain its closing would never be noticed, and without
 * the deadline a client that never closes would hold it open for good.
 */
function hangUp(client: Duplex, answer: Buffer): void {
  client.on("end", () => client.destroy());
  client.resume();
  client.end(answer);
  setTimeout(() => client.destroy(), 5000).unref();
}

function reply(client: Duplex, status: number, body: Buffer): void {
  hangUp(
    client,
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Error"}\r\n` +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${body.length}\r\n` +
          "Connection: close\r\n\r\n",
      ),
      body,
    ]),
  );
}

/**
 * A request that asks to become a raw two-way stream. Until the daemon
 * answers `101`, nothing but this one request is sent to it: a client that
 * asked for an upgrade the daemon declined does not get to keep talking to
 * the daemon over a connection nobody is reading.
 */
function takeOver(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  options: FilterOptions,
  log: (line: string) => void,
): void {
  client.on("error", () => client.destroy());
  const refuse = (status: number, message: string) => {
    log(`${status} ${req.method} ${req.url} — ${message}`);
    reply(client, status, errorBody(message));
  };

  const decision = route(req.method ?? "", req.url ?? "");
  if (decision.kind === "deny") return refuse(403, decision.reason);
  if (decision.kind !== "pass" || !decision.upgrade) {
    return refuse(403, "this request may not take over its connection");
  }
  if (req.headers["transfer-encoding"] !== undefined) {
    return refuse(400, "an upgrade request must state its body length");
  }
  const length = Number(req.headers["content-length"] ?? "0");
  if (!Number.isSafeInteger(length) || length < 0 || length > 65536) {
    return refuse(400, "an upgrade request's body is too large");
  }

  // What follows the headers is the request body, then — only if the daemon
  // upgrades — the raw stream. Hold the stream back until it has.
  let pending = head;
  const hold = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
  };
  client.on("data", hold);

  let sent = false;
  const send = () => {
    if (sent || pending.length < length) return;
    sent = true;
    const body = pending.subarray(0, length);
    pending = pending.subarray(length);

    const upstream = httpRequest({
      socketPath: options.upstream,
      method: req.method,
      path: req.url,
      // The upgrade headers are the request here, so they are kept.
      headers: without(req.rawHeaders, ["keep-alive", "proxy-connection"]),
      agent: false,
    });
    upstream.on("upgrade", (answer, daemon, daemonHead) => {
      const lines = [`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`];
      for (let i = 0; i + 1 < answer.rawHeaders.length; i += 2) {
        lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
      }
      client.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (daemonHead.length > 0) client.write(daemonHead);
      client.off("data", hold);
      if (pending.length > 0) daemon.write(pending);
      // Either side going away ends the other: a detached terminal must not
      // leave its half of the stream open in the sidecar.
      daemon.on("error", () => client.destroy());
      daemon.on("close", () => client.destroy());
      client.on("close", () => daemon.destroy());
      client.pipe(daemon);
      daemon.pipe(client);
    });
    upstream.on("response", (answer) => {
      // Declined: relay the daemon's answer and hang up.
      const chunks: Buffer[] = [];
      let size = 0;
      answer.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_RELAYED_ERROR) chunks.push(chunk);
      });
      answer.on("end", () => {
        const text = Buffer.concat(chunks);
        client.off("data", hold);
        hangUp(
          client,
          Buffer.concat([
            Buffer.from(
              `HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\n` +
                `Content-Type: ${answer.headers["content-type"] ?? "application/json"}\r\n` +
                `Content-Length: ${text.length}\r\n` +
                "Connection: close\r\n\r\n",
            ),
            text,
          ]),
        );
      });
      answer.on("error", () => client.destroy());
    });
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (client.writable) refuse(502, unavailable(error));
    });
    client.on("close", () => upstream.destroy());
    upstream.end(body);
  };
  client.on("data", send);
  send();
}
