import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fileViewKey,
  folderViewKey,
  parseFileViewKey,
  parseFolderViewKey,
} from "../src/fileview.ts";

/**
 * The window payloads a file view and a folder view are keyed under.
 *
 * The pair matters more than either alone: both kinds of window read their
 * subject back out of one string, and a key one of them accepted as the
 * other's would point a window at a path it was never opened on.
 */
describe("file and folder view keys", () => {
  it("round-trips a file, with and without a rename", () => {
    assert.deepEqual(
      parseFileViewKey(fileViewKey("/workspace/demo", "src/app.ts")),
      { projectPath: "/workspace/demo", file: "src/app.ts" },
    );
    assert.deepEqual(
      parseFileViewKey(fileViewKey("/workspace/demo", "to.ts", "from.ts")),
      { projectPath: "/workspace/demo", file: "to.ts", previousPath: "from.ts" },
    );
  });

  it("round-trips a folder", () => {
    assert.deepEqual(parseFolderViewKey(folderViewKey("/workspace/demo", "newdir/sub")), {
      projectPath: "/workspace/demo",
      folder: "newdir/sub",
    });
  });

  it("declines the other kind's key in both directions", () => {
    assert.equal(parseFileViewKey(folderViewKey("/workspace/demo", "newdir")), undefined);
    assert.equal(
      parseFolderViewKey(fileViewKey("/workspace/demo", "src/app.ts")),
      undefined,
    );
  });

  it("declines a bare target, which is what a tool turn passes", () => {
    assert.equal(parseFileViewKey("src/app.ts"), undefined);
    assert.equal(parseFolderViewKey("src/app.ts"), undefined);
  });

  it("declines a key missing either half", () => {
    assert.equal(parseFolderViewKey(folderViewKey("", "newdir")), undefined);
    assert.equal(parseFolderViewKey(folderViewKey("/workspace/demo", "")), undefined);
  });
});
