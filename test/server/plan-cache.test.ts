import { expect, test } from "vitest";
import type { Prepared } from "../../src/core/actions/action.types.js";
import type { Plan } from "../../src/core/actions/plan.types.js";
import { createPlanCache } from "../../src/server/actions/plan-cache.js";

function prepared(title: string): Prepared {
  const plan: Plan = {
    action: "ack",
    context: "test",
    title,
    summary: "",
    confirm: "Go",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [{ title: "Check nothing moved since you looked", detail: "" }],
    blockers: [],
    note: null,
    undoable: false,
    moves: [],
    expects: [],
    readAt: 0,
  };
  return { plan, execute: async () => ({ ok: true, title, lines: [], undo: null }) };
}

test("a plan is taken once, with its repo; a second take is taken", () => {
  const cache = createPlanCache();
  const one = prepared("one");
  const id = cache.put(7, one);
  expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(cache.take(id)).toEqual({ repoId: 7, prepared: one });
  expect(cache.take(id)).toBe("taken");
});

test("ids differ for every plan", () => {
  const cache = createPlanCache();
  const ids = new Set(Array.from({ length: 20 }, () => cache.put(1, prepared("p"))));
  expect(ids.size).toBe(20);
});

test("a plan past its ttl, or one never put, is expired", () => {
  let clock = 1000;
  const cache = createPlanCache({ ttlMs: 500, now: () => clock });
  const id = cache.put(1, prepared("old"));
  clock += 499;
  const fresh = cache.put(1, prepared("fresh"));
  clock += 1;
  expect(cache.take(id)).toBe("expired");
  expect(cache.take(fresh)).not.toBe("expired");
  expect(cache.take("nope")).toBe("expired");
});

test("a taken plan stays taken until its ttl, then is expired", () => {
  let clock = 0;
  const cache = createPlanCache({ ttlMs: 100, now: () => clock });
  const id = cache.put(1, prepared("p"));
  cache.take(id);
  clock = 99;
  expect(cache.take(id)).toBe("taken");
  clock = 100;
  expect(cache.take(id)).toBe("expired");
});

test("past max, the oldest untaken plan is dropped and taken plans still say taken", () => {
  const cache = createPlanCache({ max: 2 });
  const ran = cache.put(1, prepared("ran"));
  cache.take(ran);
  const first = cache.put(1, prepared("first"));
  const second = cache.put(1, prepared("second"));
  const third = cache.put(1, prepared("third"));
  expect(cache.take(first)).toBe("expired");
  expect(cache.take(ran)).toBe("taken");
  expect(cache.take(second)).not.toBe("expired");
  expect(cache.take(third)).not.toBe("expired");
});

test("peek reports a plan without taking it", () => {
  let clock = 0;
  const cache = createPlanCache({ ttlMs: 100, now: () => clock });
  const one = prepared("one");
  const id = cache.put(3, one);
  expect(cache.peek(id)).toEqual({ repoId: 3, prepared: one });
  expect(cache.peek(id)).toEqual({ repoId: 3, prepared: one });
  expect(cache.take(id)).toEqual({ repoId: 3, prepared: one });
  expect(cache.peek(id)).toBe("taken");
  expect(cache.peek("nope")).toBe("expired");
  const late = cache.put(3, one);
  clock = 200;
  expect(cache.peek(late)).toBe("expired");
});
