import { expect, test } from "vitest";
import type { Choice } from "../../src/core/actions/plan.types.js";
import type { WireSandbox } from "../../src/server/wire/wire.types.js";
import { dialogContext } from "../../ui/src/dialogs/dialog-context.js";
import { DIALOGS, type DialogContext } from "../../ui/src/dialogs/dialog-specs.js";
import { pickGroups } from "../../ui/src/dialogs/pick-groups.js";
import { feature, level, repoView } from "./wire-fixtures.js";

const stack = feature({
  id: "1.Y291cG9ucw",
  name: "checkout coupons",
  levels: [
    level({ branch: "feat/coupons-model", depth: 1, number: "01" }),
    level({ branch: "feat/coupons-ui", depth: 2, number: "02", parent: "feat/coupons-model" }),
    level({ branch: "feat/coupons-admin", depth: 2, number: "02", parent: "feat/coupons-model" }),
    level({ branch: "feat/coupons-email", depth: 3, number: "03", parent: "feat/coupons-ui" }),
  ],
});

function sandbox(path: string): WireSandbox {
  return { path, rel: path.replace("/src/acme-shop/", ""), head: "a41c0000", touchedAt: null, health: "fine", state: "Nothing to keep" };
}

function choice(id: string, overrides: Partial<Choice> = {}): Choice {
  return { id, label: id.replace("/src/acme-shop/", ""), detail: "nothing to keep", selectable: true, selected: true, health: "fine", ...overrides };
}

function context(overrides: Partial<DialogContext> = {}): DialogContext {
  return { repo: repoView({ features: [stack] }), feature: null, level: null, branch: null, targets: null, worktree: null, ...overrides };
}

test("new's input carries feature, branch, from and its three toggles, an empty branch left out", () => {
  const spec = DIALOGS.new;
  const start = spec.initial(context());
  expect(start).toMatchObject({ feature: "", branch: "", from: "main", env: true, install: false });
  expect(spec.toInput({ ...start, feature: "gift cards", branch: "feat/gift-cards-model", install: true, open: false })).toEqual({
    feature: "gift cards",
    branch: "feat/gift-cards-model",
    from: "main",
    env: true,
    install: true,
    open: false,
  });
  expect(spec.toInput({ ...start, feature: "gift cards", branch: "  " })).toEqual({ feature: "gift cards", from: "main", env: true, install: false, open: start["open"] });
  expect(spec.fields.filter((field) => field.kind === "toggle").map((field) => field.name)).toEqual(["env", "install", "open"]);
  expect(spec.fields.find((field) => field.name === "from")?.options?.(context())).toEqual([{ value: "main", label: "main" }]);
});

test("new waits for a feature name before it previews", () => {
  expect(DIALOGS.new.incomplete?.({ ...DIALOGS.new.initial(context()), feature: " " })).toBe("Name the feature.");
  expect(DIALOGS.new.incomplete?.({ ...DIALOGS.new.initial(context()), feature: "gift cards" })).toBeNull();
});

test("restack's set-aside toggle defaults on", () => {
  const spec = DIALOGS.restack;
  const values = spec.initial(context({ feature: stack }));
  expect(values["stash"]).toBe(true);
  expect(spec.fields.map((field) => [field.kind, field.name])).toEqual([["toggle", "stash"]]);
  expect(spec.toInput(values)).toEqual({ feature: "checkout coupons", stash: true });
  expect(spec.toInput({ ...values, stash: false })).toEqual({ feature: "checkout coupons", stash: false });
});

test("add-level offers the feature's levels, deepest first", () => {
  const spec = DIALOGS["add-level"];
  const ctx = context({ feature: stack });
  const on = spec.fields.find((field) => field.name === "on");
  expect(on?.kind).toBe("select");
  expect(on?.options?.(ctx).map((option) => option.value)).toEqual(["feat/coupons-email", "feat/coupons-ui", "feat/coupons-admin", "feat/coupons-model"]);
  expect(on?.options?.(ctx)[0]?.label).toBe("03 feat/coupons-email");
  const values = spec.initial(ctx);
  expect(values["on"]).toBe("feat/coupons-email");
  expect(spec.incomplete?.(values)).toBe("Name the branch.");
  expect(spec.toInput({ ...values, branch: "feat/coupons-analytics" })).toEqual({ feature: "checkout coupons", branch: "feat/coupons-analytics", on: "feat/coupons-email", env: true });
});

test("add-level from a level builds on that level", () => {
  const ctx = context({ feature: stack, level: stack.levels[1] ?? null });
  expect(DIALOGS["add-level"].initial(ctx)["on"]).toBe("feat/coupons-ui");
});

test("cleanup's input is the picked paths, and the detached sandboxes toggle together", () => {
  const ctx = context({ repo: repoView({ features: [stack], detached: [sandbox("/src/acme-shop/.worktrees/a"), sandbox("/src/acme-shop/.worktrees/b")] }) });
  const groups = pickGroups(
    [
      choice("/src/acme-shop/.worktrees/fix", { label: "fix/invoice", detail: "copies 1 file to main first", health: "loses" }),
      choice("/src/acme-shop/.worktrees/a"),
      choice("/src/acme-shop/.worktrees/b"),
      choice("/src/acme-shop/.worktrees/bump", { label: "chore/bump", detail: "2 commits only here", selectable: false, selected: false }),
    ],
    ctx,
  );
  expect(groups.map((group) => group.ids)).toEqual([["/src/acme-shop/.worktrees/fix"], ["/src/acme-shop/.worktrees/a", "/src/acme-shop/.worktrees/b"], ["/src/acme-shop/.worktrees/bump"]]);
  expect(groups[1]).toMatchObject({ label: "2 detached sandboxes", detail: "nothing to keep", selectable: true });
  expect(groups[2]).toMatchObject({ selectable: false, detail: "2 commits only here" });

  const spec = DIALOGS.cleanup;
  expect(spec.fields.map((field) => [field.kind, field.name])).toEqual([["picks", "paths"]]);
  expect(spec.toInput(spec.initial(ctx))).toEqual({});
  expect(spec.toInput({ paths: ["/src/acme-shop/.worktrees/fix", "/src/acme-shop/.worktrees/a"] })).toEqual({ paths: ["/src/acme-shop/.worktrees/fix", "/src/acme-shop/.worktrees/a"] });
});

test("one detached sandbox keeps its own folder name", () => {
  const ctx = context({ repo: repoView({ detached: [sandbox("/src/acme-shop/.worktrees/a")] }) });
  expect(pickGroups([choice("/src/acme-shop/.worktrees/a")], ctx)[0]).toMatchObject({ label: ".worktrees/a", ids: ["/src/acme-shop/.worktrees/a"] });
});

test("restore takes its targets, a missing pin left for grove to find", () => {
  const spec = DIALOGS.restore;
  const values = spec.initial(context({ targets: [{ branch: "feat/a", pinRef: "refs/grove/pins/feat/a/1" }, { branch: "feat/b" }] }));
  expect(spec.toInput(values)).toEqual({ targets: [{ branch: "feat/a", pinRef: "refs/grove/pins/feat/a/1" }, { branch: "feat/b" }] });
});

test("ack, remove and copy-env take their branch or worktree", () => {
  expect(DIALOGS.ack.toInput(DIALOGS.ack.initial(context({ branch: "feat/a" })))).toEqual({ branch: "feat/a" });
  expect(DIALOGS.remove.toInput(DIALOGS.remove.initial(context({ worktree: "/w/a" })))).toEqual({ worktree: "/w/a", rescue: true });
  expect(DIALOGS["copy-env"].toInput(DIALOGS["copy-env"].initial(context({ worktree: "/w/a" })))).toEqual({ worktree: "/w/a" });
});

test("a button's data names the feature, level, branch, pin and worktree the dialog is about", () => {
  const view = repoView({ features: [stack] });
  const byBranch = dialogContext(view, { branch: "feat/coupons-ui", pin: "refs/grove/pins/feat/coupons-ui/1" });
  expect(byBranch.feature?.name).toBe("checkout coupons");
  expect(byBranch.level?.branch).toBe("feat/coupons-ui");
  expect(byBranch.branch).toBe("feat/coupons-ui");
  expect(byBranch.targets).toEqual([{ branch: "feat/coupons-ui", pinRef: "refs/grove/pins/feat/coupons-ui/1" }]);
  expect(byBranch.worktree).toBe(stack.levels[1]?.worktree?.path);

  const byFeature = dialogContext(view, { feature: "1.Y291cG9ucw" });
  expect(byFeature).toMatchObject({ level: null, branch: null, targets: null, worktree: null });
  expect(byFeature.feature?.id).toBe("1.Y291cG9ucw");

  const deleted = dialogContext(view, { branch: "feat/gone" });
  expect(deleted).toMatchObject({ feature: null, level: null, branch: "feat/gone", targets: [{ branch: "feat/gone" }] });
});
