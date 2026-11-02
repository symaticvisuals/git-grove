import { expect, test } from "vitest";
import { raw } from "../../ui/src/html.js";
import { treeGutter } from "../../ui/src/render/tree-gutter.js";

const STACK = [{ depth: 1 }, { depth: 2 }, { depth: 3 }, { depth: 2 }];

test("treeGutter draws an elbow at depth 2 and a through-line when a later sibling exists", () => {
  const second = treeGutter(STACK, 1).text;
  expect(second).toContain('d="M7 0 V14 A6 6 0 0 0 13 20 H19"');
  expect(second).toContain('d="M7 14 V40"');
  const last = treeGutter(STACK, 3).text;
  expect(last).toContain('d="M7 0 V14 A6 6 0 0 0 13 20 H19"');
  expect(last).not.toContain('d="M7 14 V40"');
});

test("a level with a child draws the line down to it, and a deeper level keeps its ancestor's line", () => {
  expect(treeGutter(STACK, 0).text).toContain('d="M7 30 V40"');
  const third = treeGutter(STACK, 2).text;
  expect(third).toContain('d="M7 0 V40"');
  expect(third).toContain('d="M29 0 V14 A6 6 0 0 0 35 20 H41"');
});

test("the gutter is as wide as its depth and puts the icon on the level's column, with no inline style", () => {
  const out = treeGutter(STACK, 2, raw("<svg id=icon></svg>")).text;
  expect(out).toContain('width="58"');
  expect(out).toContain('<g transform="translate(44 13)"><svg id=icon></svg></g>');
  expect(out).not.toContain("style=");
});

test("a row outside a stack draws no lines", () => {
  expect(treeGutter([{ depth: 0 }], 0).text).not.toContain("<path");
});
