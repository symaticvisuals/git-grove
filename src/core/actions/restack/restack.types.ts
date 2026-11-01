import type { RepoFacts, Sha, StackEdge, WorktreeFacts } from "../../facts/facts.types.js";
import type { Feature } from "../../stacks/stacks.types.js";
import type { RestackMove } from "./order-restack.js";

/**
 * A level a restack moves, as its plan read it. `number` is the level's two-digit depth; `parent` is the branch it forked
 * from, the old parent when it moves onto the trunk. `ontoRef` is resolved again just before the level moves.
 */
export type RestackLevel = {
  move: RestackMove;
  number: string;
  label: string;
  ontoLabel: string;
  ontoRef: string;
  ontoSha: Sha;
  parent: string;
  tip: Sha;
  fork: Sha;
  own: number;
  edge: StackEdge | undefined;
  holder: WorktreeFacts | undefined;
  dirty: string[];
  busy: WorktreeFacts | undefined;
};

/**
 * Everything a restack plan read. `untouched` labels the levels left alone; `conflicts` is the prediction for the first
 * level that moves, null when git cannot make one; `stashMessage` names what the run sets aside.
 */
export type RestackRead = {
  feature: Feature;
  stash: boolean;
  stashMessage: string;
  levels: RestackLevel[];
  untouched: string[];
  tips: Map<string, Sha>;
  trunk: RepoFacts["trunk"];
  rewritten: string[];
  conflicts: string[] | null;
};
