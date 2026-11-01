import type { Lane, Plan } from "../core/actions/plan.types.js";

function section(heading: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ["", heading, ...lines.map((line) => `  ${line}`)];
}

function laneLines(lane: Lane): string[] {
  return [...lane.commits].reverse().map((commit) => {
    const marks = [commit.tip ? "tip" : "", commit.lost ? "lost" : "", commit.pinned ? "pinned" : ""].filter(Boolean);
    return `${commit.sha.slice(0, 7)}  ${commit.subject}${marks.length > 0 ? `  (${marks.join(", ")})` : ""}`;
  });
}

/** Renders a plan for the terminal: what it does, its lanes, checks, effects, steps, commands and blockers. */
export function renderPlan(plan: Plan): string {
  const lines = [plan.context, plan.title, plan.summary].filter((line) => line !== "");
  for (const lane of [plan.before, plan.after]) if (lane) lines.push(...section(lane.caption, laneLines(lane)));
  lines.push(...section("Folders", (plan.folders ?? []).map((f) => `${f.isNew ? "+" : " "} ${f.path}${f.note ? `  ${f.note}` : ""}`)));
  lines.push(
    ...section(
      "Choose",
      (plan.choices ?? []).map((c) => `[${c.selected ? "x" : c.selectable ? " " : "-"}] ${c.label}${c.detail ? `  ${c.detail}` : ""}`),
    ),
  );
  lines.push(...section("Checks", plan.checks.flatMap((c) => [`${c.ok ? "✓" : "✖"} ${c.text}`, ...(c.why ? [`    ${c.why}`] : [])])));
  lines.push(...section("Grove will also", plan.effects.map((effect) => `· ${effect}`)));
  lines.push(...section("Steps", plan.steps.map((step, index) => `${index + 1}. ${step.title}${step.detail ? `  ${step.detail}` : ""}`)));
  lines.push(...section("Commands", plan.commands));
  lines.push(...section("Blocked", plan.blockers.map((blocker) => `✖ ${blocker}`)));
  if (plan.note) lines.push("", plan.note);
  return `${lines.join("\n")}\n`;
}
