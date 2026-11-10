import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageMimeType, isClientMessage } from "@overseer/protocol";

/**
 * Guards for `project.git.image` — the frame that reads an image's bytes for
 * the image view. It is held to the same path contract as `project.git.show`
 * (see wire-git-show.test.ts for the reasoning), plus one thing more: the name
 * has to be an image, so this frame cannot become a second, unclipped way to
 * read any file in a project.
 */
describe("imageMimeType", () => {
  it("names the formats a browser draws, case-insensitively", () => {
    assert.equal(imageMimeType("logo.png"), "image/png");
    assert.equal(imageMimeType("docs/shot.JPG"), "image/jpeg");
    assert.equal(imageMimeType("a/b/photo.jpeg"), "image/jpeg");
    assert.equal(imageMimeType("anim.gif"), "image/gif");
    assert.equal(imageMimeType("hero.webp"), "image/webp");
    assert.equal(imageMimeType("icon.svg"), "image/svg+xml");
    assert.equal(imageMimeType("favicon.ico"), "image/x-icon");
  });

  it("declines anything else", () => {
    assert.equal(imageMimeType("src/app.ts"), undefined);
    assert.equal(imageMimeType("README"), undefined);
    assert.equal(imageMimeType("design.psd"), undefined);
    // The dot belongs to a folder, not the file.
    assert.equal(imageMimeType("assets.png/notes"), undefined);
    assert.equal(imageMimeType("png"), undefined);
  });
});

describe("project.git.image guard", () => {
  const image = (file: unknown, path: unknown = "/workspace/demo") =>
    isClientMessage({ type: "project.git.image", path, file });

  it("accepts a repo-relative image", () => {
    assert.equal(image("assets/logo.png"), true);
    assert.equal(image("docs/café.svg"), true);
  });

  it("rejects a file that is not an image", () => {
    assert.equal(image("src/ops.ts"), false);
    assert.equal(image(".env"), false);
  });

  it("rejects an escape, an absolute path, or a flag", () => {
    assert.equal(image("../../etc/logo.png"), false);
    assert.equal(image("/etc/logo.png"), false);
    assert.equal(image("-p.png"), false);
    assert.equal(image("a\0.png"), false);
  });

  it("rejects a missing project path or file", () => {
    // By hand: `image`'s default parameter would refill an omitted path.
    assert.equal(
      isClientMessage({ type: "project.git.image", file: "logo.png" }),
      false,
    );
    assert.equal(image(undefined), false);
  });
});
