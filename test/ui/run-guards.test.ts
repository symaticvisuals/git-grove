import { expect, test } from "vitest";
import { createApi } from "../../ui/src/api.js";
import { ApiError } from "../../ui/src/api.error.js";
import { isServerEvent } from "../../ui/src/is-server-event.js";
import { plan } from "./wire-fixtures.js";

const receipt = { action: "restore", ok: true, refused: false, title: "Restored", lines: ["Moved"], pins: [], undo: [{ branch: "feat/x", pinRef: "refs/grove/pins/feat/x/1" }], at: 1 };

test("step and receipt events are passed on only with their fields", () => {
  expect(isServerEvent({ type: "step", runId: "r", event: { index: 0, state: "done", detail: "", ms: 3 } })).toBe(true);
  expect(isServerEvent({ type: "step", runId: "r", event: { index: 0, state: "exploded", detail: "", ms: 3 } })).toBe(false);
  expect(isServerEvent({ type: "step", runId: "r", event: { index: "0", state: "done", detail: "", ms: null } })).toBe(false);
  expect(isServerEvent({ type: "receipt", runId: "r", receipt })).toBe(true);
  expect(isServerEvent({ type: "receipt", runId: "r", receipt: { ...receipt, lines: "Moved" } })).toBe(false);
  expect(isServerEvent({ type: "receipt", runId: "r", receipt: { ...receipt, undo: [{ branch: "feat/x" }] } })).toBe(false);
});

test("a plan or run state missing a field the dialog reads is refused as unexpected", async () => {
  const reply = (body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const { effects: _effects, ...noEffects } = plan();
  const failed = await createApi(reply({ planId: "p", plan: noEffects }), "t".repeat(64)).plan({ repo: 1, action: "restore", input: {} }).catch((error: unknown) => error);
  expect(failed).toBeInstanceOf(ApiError);
  const good = await createApi(reply({ plan: plan(), events: [{ index: 0, state: "running", detail: "", ms: null }], receipt: null }), "t".repeat(64)).runState("r");
  expect(good.events).toHaveLength(1);
  const bad = await createApi(reply({ plan: plan(), events: [{ index: 0 }], receipt: null }), "t".repeat(64)).runState("r").catch((error: unknown) => error);
  expect(bad).toBeInstanceOf(ApiError);
});
