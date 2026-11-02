import type { Choice } from "../../../src/core/actions/plan.types.js";
import { plural } from "../plural.js";
import type { DialogContext } from "./dialog-specs.js";

/** One line of a cleanup checklist: the choices it picks or drops together. */
export type PickGroup = { key: string; ids: string[]; label: string; detail: string; selectable: boolean; health: Choice["health"] };

const RANK: Record<Choice["health"], number> = { loses: 0, idle: 1, fine: 2 };

function single(choice: Choice): PickGroup {
  return { key: choice.id, ids: [choice.id], label: choice.label, detail: choice.detail, selectable: choice.selectable, health: choice.selectable ? choice.health : "idle" };
}

function blockedLast(groups: PickGroup[]): PickGroup[] {
  return [...groups.filter((group) => group.selectable), ...groups.filter((group) => !group.selectable)];
}

/**
 * The checklist lines for a cleanup plan's choices: each worktree on its own, except the detached sandboxes that can
 * be picked, which share one line where the first of them stood once there are two or more. Blocked worktrees come
 * last, idle, each with its reason.
 */
export function pickGroups(choices: readonly Choice[], ctx: DialogContext): PickGroup[] {
  const detached = new Set(ctx.repo.detached.map((sandbox) => sandbox.path));
  const together = choices.filter((choice) => choice.selectable && detached.has(choice.id));
  if (together.length < 2) return blockedLast(choices.map(single));
  const details = [...new Set(together.map((choice) => choice.detail))];
  const shared: PickGroup = {
    key: "detached",
    ids: together.map((choice) => choice.id),
    label: plural(together.length, "detached sandbox", "detached sandboxes"),
    detail: details.join("; "),
    selectable: true,
    health: together.reduce<Choice["health"]>((worst, choice) => (RANK[choice.health] < RANK[worst] ? choice.health : worst), "fine"),
  };
  const first = together[0];
  return blockedLast(choices.flatMap((choice) => (choice === first ? [shared] : together.includes(choice) ? [] : [single(choice)])));
}
