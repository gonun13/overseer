/**
 * What a console may ask the Docker sidecar for (spec/architecture.md §6.3).
 *
 * The sidecar's daemon is privileged, so a request it honours runs with that
 * privilege. This file decides, from the request alone, which ones go through:
 * ordinary `docker compose` work does, and the handful of options that hand a
 * container the sidecar itself — privileged mode, its namespaces, its devices,
 * its filesystem — do not.
 *
 * Pure: no sockets, and the one filesystem question it asks (where does this
 * path really lead?) comes in as a function, so every rule here is testable.
 */
import { posix } from "node:path";

export class Denied extends Error {}

export interface PolicyOptions {
  /** Absolute directories a bind mount may come from, symlinks resolved. */
  readonly bindRoots: readonly string[];
  /**
   * The real location of a bind source, following symlinks. Must throw
   * `Denied` when it cannot say — a link whose target it cannot see is not
   * "nowhere", it is somewhere in the sidecar this process is not looking at.
   */
  readonly resolve: (path: string) => string;
}

export type Inspector =
  "containerCreate" | "execCreate" | "volumeCreate" | "networkCreate";

export type Route =
  | { readonly kind: "pass"; readonly upgrade: boolean }
  | { readonly kind: "inspect"; readonly inspector: Inspector }
  | { readonly kind: "deny"; readonly reason: string };

const pass = (upgrade = false): Route => ({ kind: "pass", upgrade });
const inspect = (inspector: Inspector): Route => ({
  kind: "inspect",
  inspector,
});
const deny = (reason: string): Route => ({ kind: "deny", reason });

/**
 * The daemon's router decodes and cleans a path before matching it, so a
 * request this file read differently would be matched there as something
 * else. Rather than reproduce that, only paths that need no interpreting are
 * accepted: plain characters, no escapes, no empty or dot segments.
 */
const PLAIN_PATH = /^\/[A-Za-z0-9._~:@+,=/-]*$/;
const VERSION_PREFIX = /^\/v[0-9]+\.[0-9]+(?=\/)/;

/** Decide a request from its method and request target alone. */
export function route(method: string, target: string): Route {
  const rawPath = target.split("?", 1)[0] ?? "";
  if (!PLAIN_PATH.test(rawPath)) {
    return deny("the request path has characters the filter does not accept");
  }
  const segments = rawPath.replace(VERSION_PREFIX, "").split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return deny("the request path is not in its plain form");
  }
  const [area, second, third] = segments;
  const last = segments[segments.length - 1];
  const count = segments.length;

  // Reads change nothing in the sidecar. The one read that carries a stream
  // both ways is attaching to a container over a websocket.
  if (method === "GET" || method === "HEAD") {
    return pass(area === "containers" && third === "attach");
  }

  if (method === "POST") {
    if (area === "containers") {
      if (count === 2 && second === "create") return inspect("containerCreate");
      if (count === 2 && second === "prune") return pass();
      if (count === 3 && third === "exec") return inspect("execCreate");
      if (count === 3 && third === "attach") return pass(true);
      if (count === 3 && CONTAINER_ACTIONS.has(third ?? "")) return pass();
    }
    if (area === "exec" && count === 3) {
      if (third === "start") return pass(true);
      if (third === "resize") return pass();
    }
    if (area === "images") {
      if (count === 2 && IMAGE_ACTIONS.has(second ?? "")) return pass();
      // An image name has slashes of its own: images/<name…>/tag.
      if (count >= 3 && (last === "tag" || last === "push")) return pass();
    }
    if (area === "networks") {
      if (count === 2 && second === "create") return inspect("networkCreate");
      if (count === 2 && second === "prune") return pass();
      if (count === 3 && (third === "connect" || third === "disconnect")) {
        return pass();
      }
    }
    if (area === "volumes") {
      if (count === 2 && second === "create") return inspect("volumeCreate");
      if (count === 2 && second === "prune") return pass();
    }
    if (area === "build" && (count === 1 || second === "prune")) return pass();
    if (count === 1 && (area === "commit" || area === "auth")) return pass();
    // BuildKit: the build's own two-way channels.
    if (count === 1 && (area === "session" || area === "grpc")) {
      return pass(true);
    }
  }

  if (method === "PUT") {
    if (area === "containers" && count === 3 && third === "archive") {
      return pass();
    }
  }

  if (method === "DELETE") {
    if (area === "containers" && count === 2) return pass();
    if (area === "networks" && count === 2) return pass();
    if (area === "volumes" && count === 2) return pass();
    if (area === "images" && count >= 2) return pass();
  }

  return deny(`${method} /${segments.join("/")} is not on the filter's list`);
}

const CONTAINER_ACTIONS = new Set([
  "start",
  "stop",
  "restart",
  "kill",
  "wait",
  "resize",
  "rename",
  "pause",
  "unpause",
  "update",
]);

const IMAGE_ACTIONS = new Set(["create", "load", "prune"]);

/**
 * Check a request body. Throws `Denied` with the reason; returns the body to
 * send on, which is the caller's parsed value and not the bytes it arrived
 * as — so a key written twice reaches the daemon exactly as it was read here.
 */
export function inspectBody(
  inspector: Inspector,
  body: unknown,
  options: PolicyOptions,
): unknown {
  const fields = asFields(body, "the request body");
  switch (inspector) {
    case "containerCreate":
      containerCreate(fields, options);
      break;
    case "execCreate":
      if (truthy(field(fields, "Privileged"))) {
        throw new Denied("a privileged exec is not allowed");
      }
      break;
    case "volumeCreate":
      volumeCreate(fields);
      break;
    case "networkCreate":
      networkCreate(fields);
      break;
  }
  return body;
}

type Fields = Record<string, unknown>;

function asFields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Denied(`${what} is not an object`);
  }
  return value as Fields;
}

/**
 * Read one field the way the daemon will. Its decoder matches a key to a
 * field without regard to case, and folds a few non-ASCII letters onto ASCII
 * ones while doing so, so `privileged` and `Privileged` are the same field
 * there. Here they would be two — so any spelling but the canonical one is
 * refused rather than guessed at.
 */
function field(fields: Fields, name: string): unknown {
  const lower = name.toLowerCase();
  for (const key of Object.keys(fields)) {
    if (key === name) continue;
    if (/[^\x20-\x7e]/.test(key)) {
      throw new Denied(
        "a field name has characters the filter does not accept",
      );
    }
    if (key.toLowerCase() === lower) {
      throw new Denied(`"${key}" must be spelled "${name}"`);
    }
  }
  return fields[name];
}

const absent = (value: unknown): boolean =>
  value === undefined || value === null;

const truthy = (value: unknown): boolean => !absent(value) && value !== false;

function emptyList(value: unknown): boolean {
  return absent(value) || (Array.isArray(value) && value.length === 0);
}

function emptyMap(value: unknown): boolean {
  return (
    absent(value) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0)
  );
}

function strings(value: unknown, what: string): string[] {
  if (absent(value)) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Denied(`${what} is not a list of strings`);
  }
  return value as string[];
}

function text(value: unknown, what: string): string {
  if (absent(value)) return "";
  if (typeof value !== "string") throw new Denied(`${what} is not a string`);
  return value;
}

/** Namespaces a container may not borrow from the sidecar. */
const HOST_MODES = [
  ["NetworkMode", "the sidecar's network"],
  ["PidMode", "the sidecar's processes"],
  ["IpcMode", "the sidecar's IPC"],
  ["UTSMode", "the sidecar's hostname"],
  ["UsernsMode", "the sidecar's user namespace"],
  ["CgroupnsMode", "the sidecar's cgroups"],
] as const;

/**
 * Capabilities a container may ask for: the ones Docker grants anyway, and
 * `SYS_NICE`, which database images ask for and which reaches nothing outside
 * the container.
 */
const ALLOWED_CAPABILITIES = new Set([
  "AUDIT_WRITE",
  "CHOWN",
  "DAC_OVERRIDE",
  "FOWNER",
  "FSETID",
  "KILL",
  "MKNOD",
  "NET_BIND_SERVICE",
  "NET_RAW",
  "SETFCAP",
  "SETGID",
  "SETPCAP",
  "SETUID",
  "SYS_CHROOT",
  "SYS_NICE",
]);

function containerCreate(body: Fields, options: PolicyOptions): void {
  const raw = field(body, "HostConfig");
  if (absent(raw)) return;
  const host = asFields(raw, "HostConfig");

  if (truthy(field(host, "Privileged"))) {
    throw new Denied("privileged containers are not allowed");
  }
  for (const [name, what] of HOST_MODES) {
    const mode = text(field(host, name), name).trim().toLowerCase();
    if (mode === "host") {
      throw new Denied(`a container may not share ${what} (${name}: host)`);
    }
  }
  for (const cap of strings(field(host, "CapAdd"), "CapAdd")) {
    const name = cap.toUpperCase().replace(/^CAP_/, "");
    if (!ALLOWED_CAPABILITIES.has(name)) {
      throw new Denied(`adding the ${name} capability is not allowed`);
    }
  }
  for (const opt of strings(field(host, "SecurityOpt"), "SecurityOpt")) {
    if (!/^no-new-privileges([:=](true|false))?$/.test(opt)) {
      throw new Denied(`the security option "${opt}" is not allowed`);
    }
  }
  for (const name of ["Devices", "DeviceCgroupRules", "DeviceRequests"]) {
    if (!emptyList(field(host, name))) {
      throw new Denied(`giving a container devices is not allowed (${name})`);
    }
  }
  // Present-but-empty is how a client asks for /proc and /sys unmasked.
  for (const name of ["MaskedPaths", "ReadonlyPaths"]) {
    if (!absent(field(host, name))) {
      throw new Denied(`changing ${name} is not allowed`);
    }
  }
  const runtime = text(field(host, "Runtime"), "Runtime");
  if (runtime !== "" && runtime !== "runc") {
    throw new Denied(`the runtime "${runtime}" is not allowed`);
  }
  if (text(field(host, "CgroupParent"), "CgroupParent") !== "") {
    throw new Denied("choosing a cgroup parent is not allowed");
  }
  localDriver(field(host, "VolumeDriver"), "VolumeDriver");

  for (const bind of strings(field(host, "Binds"), "Binds")) {
    checkBind(bind, options);
  }
  const mounts = field(host, "Mounts");
  if (!absent(mounts)) {
    if (!Array.isArray(mounts)) throw new Denied("Mounts is not a list");
    for (const mount of mounts) checkMount(asFields(mount, "a mount"), options);
  }
}

function localDriver(value: unknown, what: string): void {
  const driver = text(value, what);
  if (driver !== "" && driver !== "local") {
    throw new Denied(`the volume driver "${driver}" is not allowed`);
  }
}

/** `source:target[:options]`, the short form `docker run -v` sends. */
function checkBind(bind: string, options: PolicyOptions): void {
  const parts = bind.split(":");
  const source = parts[0] ?? "";
  // One part is a path inside the container: an anonymous volume.
  if (parts.length === 1) return;
  // A name, not a path: a volume the daemon keeps in its own store.
  if (!source.startsWith("/")) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source)) {
      throw new Denied(`"${source}" is neither a volume name nor a path`);
    }
    return;
  }
  checkSource(source, options);
}

function checkMount(mount: Fields, options: PolicyOptions): void {
  const type = text(field(mount, "Type"), "a mount's Type");
  if (type === "tmpfs") return;
  if (type === "bind") {
    checkSource(text(field(mount, "Source"), "a mount's Source"), options);
    return;
  }
  if (type === "volume") {
    const raw = field(mount, "VolumeOptions");
    if (absent(raw)) return;
    const config = field(asFields(raw, "VolumeOptions"), "DriverConfig");
    if (absent(config)) return;
    const driver = asFields(config, "DriverConfig");
    localDriver(field(driver, "Name"), "a volume's driver");
    if (!emptyMap(field(driver, "Options"))) {
      throw new Denied("volume driver options are not allowed");
    }
    return;
  }
  throw new Denied(`"${type}" mounts are not allowed`);
}

/**
 * A bind mount's source is a path in the sidecar, and the sidecar holds its
 * own daemon. Only the directories it shares with the app are fair game.
 */
function checkSource(source: string, options: PolicyOptions): void {
  if (!source.startsWith("/") || source.includes("\0")) {
    throw new Denied(`"${source}" is not an absolute path`);
  }
  if (source.split("/").includes("..")) {
    throw new Denied(`"${source}" must not contain ".."`);
  }
  const real = options.resolve(posix.normalize(source));
  const inside = options.bindRoots.some(
    (root) => real === root || real.startsWith(`${root}/`),
  );
  if (!inside) {
    throw new Denied(
      `"${source}" is outside what a container may mount (${options.bindRoots.join(", ")})`,
    );
  }
}

function volumeCreate(body: Fields): void {
  localDriver(field(body, "Driver"), "the volume driver");
  // The local driver's options can point a volume at any path in the sidecar.
  if (!emptyMap(field(body, "DriverOpts"))) {
    throw new Denied("volume driver options are not allowed");
  }
  if (!absent(field(body, "ClusterVolumeSpec"))) {
    throw new Denied("cluster volumes are not allowed");
  }
}

function networkCreate(body: Fields): void {
  const driver = text(field(body, "Driver"), "the network driver");
  if (driver !== "" && driver !== "bridge") {
    throw new Denied(`the network driver "${driver}" is not allowed`);
  }
}
