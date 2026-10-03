import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_WINDOW_W,
  TILE_GAP,
  tileGrid,
  type Bounds,
  type Geometry,
} from "../src/layout.ts";

/** The stage of a 1920×1080 field: the middle three fifths, less gutter. */
const STAGE: Bounds = { left: 396, top: 12, right: 1524, bottom: 1068 };

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

  it("leaves only the minimum gap between neighbours", () => {
    const [a, b] = tileGrid(2, STAGE);
    assert.equal(b.x - (a.x + a.w), TILE_GAP);
  });
});
