import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FLOATING_CLOCK_H,
  FLOATING_CLOCK_W,
  MIN_WINDOW_W,
  TILE_GAP,
  WINDOW_Z_BASE,
  clockOverlap,
  restack,
  tileGrid,
  type Bounds,
  type Geometry,
} from "../src/layout.ts";

/** The stage of a 1920×1080 field: between the two 286px rails, less gutter. */
const STAGE: Bounds = { left: 298, top: 12, right: 1622, bottom: 1068 };

function overlaps(a: Geometry, b: Geometry): boolean {
  const ah = a.h ?? 0;
  const bh = b.h ?? 0;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + bh && b.y < a.y + ah;
}

describe("tileGrid", () => {
  it("is empty for no windows", () => {
    assert.deepEqual(tileGrid(0, STAGE), []);
  });

  it("gives one window the whole stage", () => {
    const [only] = tileGrid(1, STAGE);
    assert.equal(only.x, STAGE.left);
    assert.equal(only.y, STAGE.top);
    assert.equal(only.w, STAGE.right - STAGE.left);
    assert.equal(only.h, STAGE.bottom - STAGE.top);
  });

  for (const n of [2, 3, 5, 9]) {
    it(`keeps ${n} windows inside the stage without overlap`, () => {
      const cells = tileGrid(n, STAGE);
      assert.equal(cells.length, n);
      for (const c of cells) {
        assert.ok(c.x >= STAGE.left && c.x + c.w <= STAGE.right, `x ${c.x}`);
        assert.ok(
          c.y >= STAGE.top && c.y + (c.h ?? 0) <= STAGE.bottom,
          `y ${c.y}`,
        );
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          assert.equal(overlaps(cells[i], cells[j]), false, `${i} × ${j}`);
        }
      }
    });
  }

  it("adds rows rather than columns narrower than the minimum", () => {
    // 864 wide fits two 320 columns, not the three six windows would want.
    const narrow: Bounds = { left: 290, top: 2, right: 1150, bottom: 898 };
    const cells = tileGrid(6, narrow);
    assert.equal(new Set(cells.map((c) => c.x)).size, 2);
    for (const c of cells) assert.ok(c.w >= MIN_WINDOW_W);
  });

  it("stays inside a stage too small for the minimum", () => {
    const tiny: Bounds = { left: 0, top: 0, right: 200, bottom: 300 };
    const cells = tileGrid(4, tiny);
    for (const c of cells) {
      assert.ok(c.x + c.w <= tiny.right);
      assert.ok(c.y + (c.h ?? 0) <= tiny.bottom);
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        assert.equal(overlaps(cells[i], cells[j]), false);
      }
    }
  });

  it("stacks the second window under the first", () => {
    const [a, b] = tileGrid(2, STAGE);
    assert.equal(a.x, b.x);
    assert.equal(a.w, STAGE.right - STAGE.left);
    assert.ok(b.y > a.y);
  });

  it("fills each column top to bottom before the next", () => {
    const cells = tileGrid(4, STAGE);
    assert.equal(cells[0].x, cells[1].x);
    assert.equal(cells[2].x, cells[3].x);
    assert.ok(cells[2].x > cells[0].x);
    assert.ok(cells[1].y > cells[0].y);
  });

  it("gives a short last column the full height", () => {
    const [, , third] = tileGrid(3, STAGE);
    assert.equal(third.y, STAGE.top);
    assert.equal(third.h, STAGE.bottom - STAGE.top);
  });

  it("leaves only the minimum gap between neighbours", () => {
    const [a, b, c] = tileGrid(3, STAGE);
    assert.equal(b.y - (a.y + (a.h ?? 0)), TILE_GAP);
    assert.equal(c.x - (a.x + a.w), TILE_GAP);
  });
});

describe("clockOverlap", () => {
  /** A 1280×720 fullscreen stage, less its gutter. */
  const FULL: Bounds = { left: 2, top: 2, right: 1278, bottom: 718 };

  it("gives the top-right window's tab exactly the clock's width", () => {
    const cells = tileGrid(4, FULL);
    const overlaps = cells.map((cell) => clockOverlap(cell, FULL));
    // Vertical first: the top-right cell is the third.
    assert.deepEqual(overlaps, [0, 0, FLOATING_CLOCK_W, 0]);
  });

  it("leaves a window below the clock alone", () => {
    assert.equal(
      clockOverlap({ x: 600, y: 2 + FLOATING_CLOCK_H, w: 678 }, FULL),
      0,
    );
  });

  it("counts only the part of the tab under the clock", () => {
    const right = FULL.right - FLOATING_CLOCK_W + 30;
    assert.equal(clockOverlap({ x: 200, y: 10, w: right - 200 }, FULL), 30);
  });
});

describe("restack", () => {
  const w = (id: string, z: number) => ({ id, z });

  it("ranks from the base, keeping the order", () => {
    assert.deepEqual(restack([w("a", 900), w("b", 400)]), [
      w("a", WINDOW_Z_BASE + 1),
      w("b", WINDOW_Z_BASE),
    ]);
  });

  it("puts the raised window on top without growing the stack", () => {
    let stack = [w("a", 0), w("b", 0), w("c", 0)];
    stack = restack(stack);
    for (let i = 0; i < 500; i++) stack = restack(stack, i % 2 ? "a" : "b");
    const max = Math.max(...stack.map((x) => x.z));
    assert.equal(max, WINDOW_Z_BASE + 2);
    assert.equal(stack.find((x) => x.z === max)?.id, "a");
  });

  it("returns the same array when the raised window is already on top", () => {
    const stack = restack([w("a", 0), w("b", 1)]);
    assert.equal(restack(stack, "b"), stack);
  });
});
