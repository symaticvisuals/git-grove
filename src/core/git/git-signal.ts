import { AsyncLocalStorage } from "node:async_hooks";

/** The abort signal of every git call `runGit` makes inside `gitSignal.run(signal, …)`; when it fires, git is killed. */
export const gitSignal = new AsyncLocalStorage<AbortSignal>();
