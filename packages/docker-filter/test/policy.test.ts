import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Denied,
  inspectBody,
  route,
  type Inspector,
  type PolicyOptions,
} from "../src/policy.ts";

/** No filesystem: a path resolves to itself unless a test says otherwise. */
function policy(links: Record<string, string> = {}): PolicyOptions {
  return {
    bindRoots: ["/workspace", "/app/loop/db"],
    resolve: (path) => {
      for (const [link, target] of Object.entries(links)) {
        if (path === link) return target;
        if (path.startsWith(`${link}/`))
          return target + path.slice(link.length);
      }
      return path;
    },
  };
}

const allowed = (inspector: Inspector, body: unknown, options = policy()) =>
  assert.doesNotThrow(() => inspectBody(inspector, body, options));

const denied = (
  inspector: Inspector,
  body: unknown,
  reason: RegExp,
  options = policy(),
) =>
  assert.throws(
    () => inspectBody(inspector, body, options),
    (error) => error instanceof Denied && reason.test(error.message),
  );

const host = (config: Record<string, unknown>) => ({
  Image: "node:22",
  HostConfig: config,
});

describe("route", () => {
  it("passes every read", () => {
    assert.deepEqual(route("GET", "/_ping"), { kind: "pass", upgrade: false });
    assert.equal(route("HEAD", "/_ping").kind, "pass");
    assert.equal(route("GET", "/v1.51/containers/json?all=1").kind, "pass");
    assert.equal(route("GET", "/v1.51/plugins").kind, "pass");
  });

  it("inspects the requests that create something", () => {
    for (const [target, inspector] of [
      ["/v1.51/containers/create?name=web-1", "containerCreate"],
      ["/containers/create", "containerCreate"],
      ["/v1.51/containers/abc123/exec", "execCreate"],
      ["/v1.51/volumes/create", "volumeCreate"],
      ["/v1.51/networks/create", "networkCreate"],
    ] as const) {
      assert.deepEqual(route("POST", target), { kind: "inspect", inspector });
    }
  });

  it("passes what compose and the CLI do every day", () => {
    for (const [method, target] of [
      ["POST", "/v1.51/containers/abc/start"],
      ["POST", "/v1.51/containers/abc/stop?t=10"],
      ["POST", "/v1.51/containers/abc/wait?condition=next-exit"],
      ["POST", "/v1.51/containers/abc/resize?h=40&w=120"],
      ["POST", "/v1.51/containers/prune"],
      ["POST", "/v1.51/exec/abc/resize?h=40&w=120"],
      ["POST", "/v1.51/images/create?fromImage=nginx&tag=alpine"],
      ["POST", "/v1.51/images/registry.example:5000/team/app:1.2/tag?repo=x"],
      ["POST", "/v1.51/images/load"],
      ["POST", "/v1.51/build?t=app"],
      ["POST", "/v1.51/build/prune"],
      ["POST", "/v1.51/networks/abc/connect"],
      ["POST", "/v1.51/networks/prune"],
      ["POST", "/v1.51/volumes/prune"],
      ["POST", "/v1.51/auth"],
      ["PUT", "/v1.51/containers/abc/archive?path=/tmp"],
      ["DELETE", "/v1.51/containers/abc?force=1&v=1"],
      ["DELETE", "/v1.51/images/team/app:1.2"],
      ["DELETE", "/v1.51/networks/app_default"],
      ["DELETE", "/v1.51/volumes/app_data"],
    ] as const) {
      assert.deepEqual(
        route(method, target),
        { kind: "pass", upgrade: false },
        `${method} ${target}`,
      );
    }
  });

  it("lets only the hijacking requests take over a connection", () => {
    for (const [method, target] of [
      ["POST", "/v1.51/containers/abc/attach?stream=1"],
      ["POST", "/v1.51/exec/abc/start"],
      ["POST", "/v1.51/session"],
      ["POST", "/v1.51/grpc"],
      ["GET", "/v1.51/containers/abc/attach/ws"],
    ] as const) {
      assert.deepEqual(route(method, target), { kind: "pass", upgrade: true });
    }
  });

  it("refuses what is not on the list", () => {
    for (const [method, target] of [
      ["POST", "/v1.51/plugins/pull"],
      ["POST", "/v1.51/swarm/init"],
      ["POST", "/v1.51/services/create"],
      ["POST", "/v1.51/containers/abc/checkpoints"],
      ["PUT", "/v1.51/volumes/data"],
      ["PATCH", "/v1.51/containers/abc"],
      ["CONNECT", "/v1.51/containers/create"],
    ] as const) {
      assert.equal(route(method, target).kind, "deny", `${method} ${target}`);
    }
  });

  it("refuses a path the daemon would read differently", () => {
    for (const target of [
      "/v1.51/containers/cre%61te",
      "/v1.51//containers/create",
      "/v1.51/containers/../containers/create",
      "/v1.51/containers/./create",
      "/v1.51/containers/create/",
      "http://dind/containers/create",
      "containers/create",
      "*",
    ]) {
      assert.equal(route("POST", target).kind, "deny", target);
    }
  });
});

describe("container create", () => {
  it("allows an ordinary compose service", () => {
    allowed("containerCreate", {
      Image: "node:22-alpine",
      Cmd: ["npm", "run", "dev"],
      Labels: { "com.docker.compose.project": "personal", Ünïcode: "fine" },
      HostConfig: {
        Binds: ["/workspace/personal:/app:rw", "/app/node_modules"],
        Mounts: [
          {
            Type: "bind",
            Source: "/workspace/otm/arquivo",
            Target: "/arquivo",
          },
          { Type: "volume", Source: "personal_modules", Target: "/m" },
          { Type: "tmpfs", Target: "/tmp" },
        ],
        NetworkMode: "personal_default",
        PortBindings: { "3000/tcp": [{ HostPort: "3000" }] },
        RestartPolicy: { Name: "unless-stopped" },
        CapAdd: ["SYS_NICE", "CAP_NET_BIND_SERVICE"],
        SecurityOpt: ["no-new-privileges:true"],
        Privileged: false,
        PidMode: "",
        IpcMode: "private",
        Devices: [],
        Runtime: "runc",
        MaskedPaths: null,
      },
    });
  });

  it("allows a body with no host config", () => {
    allowed("containerCreate", { Image: "busybox" });
    allowed("containerCreate", { Image: "busybox", HostConfig: null });
  });

  it("refuses privileged", () => {
    denied("containerCreate", host({ Privileged: true }), /privileged/);
    denied("containerCreate", host({ Privileged: "true" }), /privileged/);
  });

  it("refuses the sidecar's namespaces", () => {
    for (const name of [
      "NetworkMode",
      "PidMode",
      "IpcMode",
      "UTSMode",
      "UsernsMode",
      "CgroupnsMode",
    ]) {
      denied("containerCreate", host({ [name]: "host" }), /may not share/);
      denied("containerCreate", host({ [name]: " HOST " }), /may not share/);
    }
    allowed("containerCreate", host({ PidMode: "container:abc" }));
  });

  it("refuses capabilities beyond the default set", () => {
    denied("containerCreate", host({ CapAdd: ["SYS_ADMIN"] }), /SYS_ADMIN/);
    denied("containerCreate", host({ CapAdd: ["cap_sys_ptrace"] }), /PTRACE/);
    denied("containerCreate", host({ CapAdd: ["ALL"] }), /ALL/);
    denied("containerCreate", host({ CapAdd: "SYS_ADMIN" }), /list of strings/);
  });

  it("refuses security options that loosen confinement", () => {
    for (const opt of [
      "seccomp=unconfined",
      "apparmor=unconfined",
      "systempaths=unconfined",
      "label=disable",
    ]) {
      denied(
        "containerCreate",
        host({ SecurityOpt: [opt] }),
        /security option/,
      );
    }
  });

  it("refuses devices, unmasked paths, runtimes and cgroup parents", () => {
    denied(
      "containerCreate",
      host({ Devices: [{ PathOnHost: "/dev/vda" }] }),
      /devices/,
    );
    denied(
      "containerCreate",
      host({ DeviceCgroupRules: ["a *:* rwm"] }),
      /dev/,
    );
    denied("containerCreate", host({ DeviceRequests: [{ Count: -1 }] }), /dev/);
    denied("containerCreate", host({ MaskedPaths: [] }), /MaskedPaths/);
    denied("containerCreate", host({ ReadonlyPaths: [] }), /ReadonlyPaths/);
    denied("containerCreate", host({ Runtime: "sysbox-runc" }), /runtime/);
    denied("containerCreate", host({ CgroupParent: "/" }), /cgroup parent/);
    denied("containerCreate", host({ VolumeDriver: "sshfs" }), /volume driver/);
  });

  it("refuses a bind from outside the shared directories", () => {
    for (const bind of [
      "/:/host",
      "/var/run/docker.sock:/var/run/docker.sock",
      "/run/dind/docker.sock:/var/run/docker.sock",
      "/var/lib/docker:/d",
      "/workspace/../etc:/etc",
      "/workspacex:/x",
      "/dev:/dev:ro",
    ]) {
      denied("containerCreate", host({ Binds: [bind] }), /outside|"\.\."/);
    }
    denied(
      "containerCreate",
      host({ Mounts: [{ Type: "bind", Source: "/etc", Target: "/etc" }] }),
      /outside/,
    );
    denied(
      "containerCreate",
      host({ Mounts: [{ Type: "bind", Target: "/etc" }] }),
      /absolute/,
    );
  });

  it("allows the shared directories themselves and paths beneath them", () => {
    allowed(
      "containerCreate",
      host({
        Binds: [
          "/workspace:/workspace",
          "/workspace/otm:/workspace/otm",
          "/app/loop/db/personal/worktrees/7:/app",
          "named_volume:/data",
        ],
      }),
    );
  });

  it("follows links before deciding", () => {
    const links = policy({
      "/workspace/p/out": "/",
      "/workspace/p/in": "/workspace/q",
    });
    denied(
      "containerCreate",
      host({ Binds: ["/workspace/p/out/run/dind:/s"] }),
      /outside/,
      links,
    );
    allowed("containerCreate", host({ Binds: ["/workspace/p/in:/s"] }), links);
  });

  it("refuses a bind source that is neither a name nor a path", () => {
    denied("containerCreate", host({ Binds: ["../x:/x"] }), /neither/);
  });

  it("refuses volumes pointed at a path through driver options", () => {
    denied(
      "containerCreate",
      host({
        Mounts: [
          {
            Type: "volume",
            Target: "/x",
            VolumeOptions: {
              DriverConfig: {
                Name: "local",
                Options: { device: "/", o: "bind" },
              },
            },
          },
        ],
      }),
      /driver options/,
    );
    denied(
      "containerCreate",
      host({ Mounts: [{ Type: "cluster", Target: "/x" }] }),
      /not allowed/,
    );
  });

  it("refuses a field spelled the way only the daemon would read it", () => {
    denied("containerCreate", { hostconfig: { Privileged: true } }, /spelled/);
    denied("containerCreate", host({ privileged: true }), /spelled/);
    denied("containerCreate", host({ BINDS: ["/:/host"] }), /spelled/);
    // U+017F folds to "s" in the daemon's decoder.
    denied(
      "containerCreate",
      host({ "Bind\u017f": ["/:/host"] }),
      /characters/,
    );
    denied(
      "containerCreate",
      host({ Mounts: [{ type: "bind", Source: "/", Target: "/h" }] }),
      /spelled/,
    );
  });

  it("refuses a body that is not an object", () => {
    denied("containerCreate", [], /not an object/);
    denied("containerCreate", "x", /not an object/);
    denied("containerCreate", { HostConfig: [] }, /not an object/);
  });
});

describe("exec, volume and network create", () => {
  it("refuses a privileged exec", () => {
    allowed("execCreate", { Cmd: ["sh"], Tty: true, Privileged: false });
    denied("execCreate", { Cmd: ["sh"], Privileged: true }, /privileged exec/);
    denied("execCreate", { Cmd: ["sh"], privileged: true }, /spelled/);
  });

  it("refuses volume driver options and foreign drivers", () => {
    allowed("volumeCreate", {
      Name: "app_data",
      Driver: "local",
      DriverOpts: {},
    });
    allowed("volumeCreate", { Name: "app_data", Labels: { a: "b" } });
    denied(
      "volumeCreate",
      { Name: "x", DriverOpts: { type: "none", o: "bind", device: "/" } },
      /driver options/,
    );
    denied("volumeCreate", { Name: "x", Driver: "nfs" }, /volume driver/);
    denied("volumeCreate", { Name: "x", ClusterVolumeSpec: {} }, /cluster/);
  });

  it("allows bridge networks only", () => {
    allowed("networkCreate", { Name: "app_default", Driver: "bridge" });
    allowed("networkCreate", { Name: "app_default" });
    denied("networkCreate", { Name: "x", Driver: "macvlan" }, /network driver/);
    denied("networkCreate", { Name: "x", Driver: "host" }, /network driver/);
  });
});
