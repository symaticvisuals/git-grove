import type { FolderLine, Plan } from "../../../src/core/actions/plan.types.js";
import type { DialogContext } from "../dialogs/dialog-specs.js";
import { html, type SafeHtml } from "../html.js";

function parentFolder(plan: Plan, root: string): string {
  const created = plan.expects.find((expect) => expect.kind === "absent" && expect.path.startsWith(`${root}/`));
  if (created === undefined || created.kind !== "absent") return ".worktrees/";
  const relative = created.path.slice(root.length + 1);
  const cut = relative.lastIndexOf("/");
  return cut < 0 ? "./" : `${relative.slice(0, cut)}/`;
}

function folderLine(line: FolderLine): SafeHtml {
  const note = line.isNew ? html`<span class="new">${line.note === "" ? "new" : `new, ${line.note}`}</span>` : line.note === "" ? "" : html`<span class="on">${line.note}</span>`;
  return html`<div class="leaf">└ <b>${line.path}</b> ${note}</div>`;
}

/** The folders a plan creates beside the ones already there, under their parent folder, new ones marked new; empty when it creates none. */
export function renderFolders(plan: Plan | null, ctx: DialogContext): SafeHtml {
  const lines = plan?.folders ?? [];
  if (plan === null || lines.length === 0) return html``;
  const fresh = lines.every((line) => line.isNew);
  return html`<div class="preview" role="group" aria-label="Folders"><div>${parentFolder(plan, ctx.repo.project.root)}${fresh ? html` <span class="new">new</span>` : ""}</div>${lines.map(folderLine)}</div>`;
}
