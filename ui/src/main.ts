import type { ActionName } from "../../src/core/actions/plan.types.js";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import { adjacentRow } from "./adjacent-row.js";
import { cycleFocus } from "./cycle-focus.js";
import { adoptToken, type TokenDeps } from "./adopt-token.js";
import { announcement } from "./announcement.js";
import { type Api, createApi } from "./api.js";
import { ApiError } from "./api.error.js";
import { type ActionData, dialogContext } from "./dialogs/dialog-context.js";
import { createDialogEffects } from "./dialogs/dialog-effects.js";
import { createDialogHost } from "./dialogs/dialog-host.js";
import { DIALOGS } from "./dialogs/dialog-specs.js";
import { effectivePick } from "./effective-pick.js";
import { focusAfterClose } from "./focus-after-close.js";
import { createGuardDialogHost } from "./guard/guard-dialog-host.js";
import { createGuardEffects } from "./guard/guard-effects.js";
import { html } from "./html.js";
import { ICONS } from "./icons.js";
import { isGuardStatus } from "./is-guard-status.js";
import { keyCommand, type KeyCommand, type KeyInput, type KeyMode } from "./keys.js";
import { landmarkAfterCard } from "./landmark-after-card.js";
import { connectLive } from "./live.js";
import { loadable } from "./loadable.js";
import { MESSAGES } from "./messages.js";
import { notificationFor, type NotifyPermission } from "./notify.js";
import { createPalette } from "./palette/palette.js";
import type { PaletteItem } from "./palette/palette-items.js";
import { parseRoute, routeHash } from "./parse-route.js";
import { createRegionPainter } from "./region-painter.js";
import { detailPanel } from "./render/detail-panel.js";
import { mainView } from "./render/main-view.js";
import { sidebar } from "./render/sidebar.js";
import { scanNow } from "./scan-now.js";
import { shortcutTarget, type ShortcutKey } from "./shortcut-target.js";
import { SLICE_NAMES, type SliceName } from "./slice-names.js";
import { sliceRequests } from "./slice-requests.js";
import { initialState, reduce, type State, type Tab, type UiAction } from "./state.js";
import { timeLabel } from "./time-label.js";
import { toast } from "./toast.js";

declare const __GROVE_VERSION__: string;

const PROJECTS_EVERY_MS = 1_000;
const CLOCK_MS = 5_000;
const SPEAK_MS = 50;
const TRAPPED = 'input:not([disabled]), select:not([disabled]), button:not([disabled]), summary, a[href], [tabindex="0"]';
const FOCUS_WAIT_MS = 2_000;
const TABS: readonly Tab[] = ["feature", "health", "activity"];
const ACTION_NAMES = Object.keys(DIALOGS);
const GUARD_DISMISSED = "grove.guardCardDismissed";

function pageVersion(): string {
  const content = document.querySelector('meta[name="grove-version"]')?.getAttribute("content") ?? "";
  return content === "" || content.includes("%") ? __GROVE_VERSION__ : content;
}

const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
let state: State = initialState(parseRoute(location.hash), pageVersion());
let api: Api | null = null;
let frame = 0;
let reveal = true;
let projectsFetchedAt = 0;
let projectsTimer = 0;
let scrimOwner: "dialog" | "guard" | "palette" | null = null;
let returnFocus: string | null = null;
let focusAfterPaint: { key: string; until: number } | null = null;
let spoken: string[] = [];
let speaking = 0;
const inFlight = new Map<SliceName, { key: string; again: boolean }>();
const paintRegion = createRegionPainter();
const scrim = document.getElementById("scrim") ?? document.body;

function announce(text: string): void {
  spoken.push(text);
  if (speaking !== 0) return;
  const region = document.getElementById("announce");
  if (region !== null) region.textContent = "";
  speaking = window.setTimeout(() => {
    speaking = 0;
    const out = document.getElementById("announce");
    if (out !== null) out.textContent = spoken.map((text) => (/[.!?]$/.test(text) ? text : `${text}.`)).join(" ");
    spoken = [];
  }, SPEAK_MS);
}

const effects = createDialogEffects({ api: () => api, state: () => state, dispatch: (action) => dispatch(action), toast });
const guardEffects = createGuardEffects({ api: () => api, state: () => state, dispatch: (action) => dispatch(action), toast });

function dispatch(action: UiAction): void {
  if (action.type === "event" && action.event.type === "digest") for (const flight of inFlight.values()) flight.again = true;
  if (action.type === "route") reveal = true;
  const before = state;
  state = reduce(state, action);
  if (state === before) return;
  const spoken = announcement(before, state, action);
  if (spoken !== null) announce(spoken);
  effects.after(before, state, action);
  guardEffects.after(state);
  schedule();
  load();
}

function settle(slice: SliceName, flight: { key: string; again: boolean }, action: UiAction): void {
  if (inFlight.get(slice) === flight) inFlight.delete(slice);
  dispatch(action);
  if (flight.again && sliceRequests(state)[slice]?.key === flight.key) dispatch({ type: "invalidate", slice });
}

function projectsThrottled(): boolean {
  const wait = projectsFetchedAt + PROJECTS_EVERY_MS - Date.now();
  if (wait <= 0) {
    projectsFetchedAt = Date.now();
    return false;
  }
  if (projectsTimer === 0) {
    projectsTimer = window.setTimeout(() => {
      projectsTimer = 0;
      load();
    }, wait);
  }
  return true;
}

function load(): void {
  const client = api;
  if (client === null || state.signedOut) return;
  const requests = sliceRequests(state);
  for (const slice of SLICE_NAMES) {
    const request = requests[slice];
    if (request === null || inFlight.get(slice)?.key === request.key || !loadable(state, slice)) continue;
    if (slice === "projects" && projectsThrottled()) continue;
    const flight = { key: request.key, again: false };
    inFlight.set(slice, flight);
    request.fetch(client).then(
      (result) => settle(slice, flight, { type: "loaded", key: request.key, result }),
      (error: unknown) =>
        settle(slice, flight, {
          type: "failed",
          slice,
          key: request.key,
          status: error instanceof ApiError ? error.status : 0,
          message: error instanceof ApiError ? error.message : MESSAGES.notRunning,
        }),
    );
  }
}

function shownRepo(): WireRepoView | null {
  const { route, repo } = state;
  if (route.view !== "repo" || repo === null || repo.status === "loading" || repo.data === null) return null;
  return repo.data.project.id === route.repo ? repo.data : null;
}

function focusKey(key: string | null): boolean {
  const target = key === null ? null : document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  target?.focus({ preventScroll: true });
  return target !== null && document.activeElement === target;
}

const dialogHost = createDialogHost({ root: scrim, dispatch, paint: paintRegion });

const guardHost = createGuardDialogHost({ root: scrim, dispatch, paint: paintRegion });

const palette = createPalette({ root: scrim, dispatch, run: (item) => runPaletteItem(item) });

function paintScrim(now: number): void {
  const owner = state.palette !== null ? "palette" : state.dialog !== null ? "dialog" : state.guardDialog !== null ? "guard" : null;
  if (owner !== null && scrimOwner === null) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement ? (active.dataset["key"] ?? null) : null;
  }
  const app = document.querySelector<HTMLElement>(".app");
  if (app !== null) app.inert = owner !== null;
  scrim.classList.toggle("on", owner !== null);
  if (owner !== "dialog") dialogHost.reset();
  if (owner !== "guard") guardHost.reset();
  if (owner !== "palette") palette.reset();
  if (owner === "dialog") dialogHost.paint(state, now);
  if (owner === "guard") guardHost.paint(state, now);
  if (owner === "palette") palette.paint(state);
  if (owner === null && scrimOwner !== null) {
    scrim.innerHTML = "";
    if (!focusAfterClose(scrimOwner, returnFocus).some(focusKey)) document.querySelector<HTMLElement>("#view .row.sel")?.focus({ preventScroll: true });
    returnFocus = null;
  }
  scrimOwner = owner;
}

function paint(): void {
  const now = Date.now();
  const { route } = state;
  const view = shownRepo();
  const onRepo = route.view === "repo" && !state.signedOut;
  const pick = effectivePick(route, view);
  const header = html`<div class="ws">${ICONS.logo}<b>git grove</b><span class="local">local</span></div>`;
  const side = state.signedOut ? header : sidebar({ route, projects: state.projects, repo: view, live: state.live, now, notify: notifyPermission(), guard: state.guard });
  paintRegion(document.getElementById("side"), side, "side");
  paintRegion(document.getElementById("view"), mainView(state, now), `${route.view}:${route.view === "repo" ? route.repo : ""}:${state.tab}`);
  const detail = onRepo ? detailPanel({ repo: state.repo, pick, feature: state.feature, preview: state.preview, now }) : html``;
  paintRegion(document.getElementById("detail"), detail, pick === null || route.view !== "repo" ? "" : routeHash({ ...route, pick }));
  document.getElementById("main")?.classList.toggle("wide", !onRepo);
  document.title = view === null ? "git grove" : `${view.project.name} · git grove`;
  paintScrim(now);
  if (reveal && (route.view !== "repo" || view !== null)) {
    reveal = false;
    document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
  }
  if (focusAfterPaint !== null && (now > focusAfterPaint.until || focusKey(focusAfterPaint.key))) {
    if (now <= focusAfterPaint.until) document.activeElement?.scrollIntoView({ block: "nearest" });
    focusAfterPaint = null;
  }
}

function schedule(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint();
  });
}

function tick(): void {
  const now = Date.now();
  for (const element of document.querySelectorAll<HTMLElement>("time[data-at]")) {
    element.textContent = timeLabel(element.dataset, now);
  }
  dispatch({ type: "tick", now });
}

function notifyPermission(): NotifyPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function askToNotify(): void {
  if (notifyPermission() !== "default") return;
  void Notification.requestPermission().then((answer) => {
    if (answer === "granted") toast("You'll get a notification when work is about to be lost");
    if (answer === "denied") toast("Notifications are blocked for this page", false);
    schedule();
  });
}

function raise(event: ServerEvent): void {
  const spec = notificationFor(event);
  if (spec === null || notifyPermission() !== "granted") return;
  try {
    const shown = new Notification(spec.title, { body: spec.body, tag: spec.tag, icon: spec.icon });
    shown.addEventListener("click", () => {
      window.focus();
      location.hash = spec.href;
      shown.close();
    });
  } catch {
    // Browsers that raise notifications only from a service worker show none from the page.
  }
}

function isActionName(name: string): name is ActionName {
  return ACTION_NAMES.includes(name);
}

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : MESSAGES.notRunning;
}

function withRepo(then: (repo: WireRepoView) => void): void {
  const shown = shownRepo();
  if (shown !== null) {
    then(shown);
    return;
  }
  const projects = state.projects.status === "loading" ? [] : (state.projects.data ?? []);
  const [only] = projects;
  if (api === null || only === undefined || projects.length > 1) {
    toast(projects.length > 1 ? "Open a repo first, then start it there." : "No repo to start it in yet.", false);
    return;
  }
  api.repo(only.id).then(then, (error: unknown) => toast(failure(error), false));
}

function openIn(app: "editor" | "terminal", path: string | undefined): void {
  const client = api;
  const repo = state.route.view === "repo" ? state.route.repo : null;
  if (client === null || repo === null || path === undefined) return;
  client.open({ repo, path, app }).then(
    () => toast(app === "editor" ? "Opened in your editor" : "Opened a terminal in that worktree"),
    (error: unknown) => toast(failure(error), false),
  );
}

function openAction(name: string, data: ActionData): void {
  if (name === "palette") {
    dispatch({ type: "palette-open" });
    return;
  }
  if (name === "open-editor" || name === "open-terminal") {
    openIn(name === "open-editor" ? "editor" : "terminal", data.path);
    return;
  }
  if (!isActionName(name) || state.signedOut) return;
  withRepo((repo) => dispatch({ type: "dialog-open", action: name, ctx: dialogContext(repo, data) }));
}

function scan(repo: number | undefined): void {
  const client = api;
  if (client === null) return;
  scanNow({ api: client, repo, now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }).then(
    (result) => toast(result.text, result.ok),
    (error: unknown) => toast(failure(error), false),
  );
}

function runPaletteItem(item: PaletteItem): void {
  dispatch({ type: "palette-close" });
  const { run } = item;
  if ("open" in run) dispatch({ type: "dialog-open", action: run.open, ctx: run.ctx });
  else if ("guard" in run) dispatch({ type: "guard-open", change: run.guard });
  else if ("route" in run) {
    const hash = routeHash(run.route);
    if (run.route.view === "repo" && run.route.pick !== null) focusAfterPaint = { key: `row:${hash}`, until: Date.now() + FOCUS_WAIT_MS };
    location.hash = hash;
  } else scan(run.scan);
}

function runAction(element: HTMLElement): void {
  const data = element.dataset;
  const name = data["action"] ?? "";
  if (name === "scan") {
    const repo = Number(data["repo"]);
    scan(Number.isSafeInteger(repo) && repo > 0 ? repo : undefined);
    return;
  }
  openAction(name, { feature: data["feature"], branch: data["branch"], pin: data["pin"], path: data["path"] });
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function dismissGuardCard(status: string | undefined): void {
  if (!isGuardStatus(status)) return;
  try {
    storage()?.setItem(GUARD_DISMISSED, status);
  } catch {
    // A page that cannot store the choice hides the card for this visit only.
  }
  const rows = [...document.querySelectorAll<HTMLElement>("#view .row[data-key]")].map((row) => row.dataset["key"] ?? "");
  focusAfterPaint = { key: landmarkAfterCard(rows), until: Date.now() + FOCUS_WAIT_MS };
  dispatch({ type: "guard-dismiss", status });
}

function openGuard(): void {
  dispatch({ type: "guard-open", change: "uninstall" });
}

function isSlice(name: string | undefined): name is SliceName {
  return SLICE_NAMES.some((slice) => slice === name);
}

function runUi(element: HTMLElement): void {
  const data = element.dataset;
  switch (data["ui"]) {
    case "tab": {
      const tab = TABS.find((candidate) => candidate === data["tab"]);
      if (tab !== undefined) dispatch({ type: "tab", tab });
      return;
    }
    case "needs-only":
      dispatch({ type: "needs-only", on: !state.needsOnly });
      return;
    case "toggle-group":
      if (data["group"] !== undefined) dispatch({ type: "toggle-group", key: data["group"] });
      return;
    case "retry":
      if (isSlice(data["slice"])) dispatch({ type: "invalidate", slice: data["slice"] });
      return;
    case "reload":
      location.reload();
      return;
    case "notify":
      askToNotify();
      return;
    case "guard":
    case "guard-open":
      openGuard();
      return;
    case "guard-dismiss":
      dismissGuardCard(data["status"]);
      return;
    case "jump": {
      const group = data["group"] === undefined ? null : document.querySelector(`.group[data-group="${CSS.escape(data["group"])}"]`);
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      group?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      return;
    }
  }
}

function activate(target: Element): boolean {
  const action = target.closest<HTMLElement>("[data-action]");
  if (action !== null) {
    runAction(action);
    return true;
  }
  const ui = target.closest<HTMLElement>("[data-ui]");
  if (ui !== null) {
    runUi(ui);
    return true;
  }
  const row = target.closest<HTMLElement>("[data-href]");
  if (row?.dataset["href"] !== undefined) {
    location.hash = row.dataset["href"];
    return true;
  }
  return false;
}

function moveSelection(delta: 1 | -1): void {
  const items = [...document.querySelectorAll<HTMLElement>("#view .group.closed, #view .rows:not(.closed) > .row[data-href]")];
  const keys = items.map((item) => item.dataset["key"] ?? "");
  const active = document.activeElement;
  const from = active instanceof HTMLElement && items.includes(active) ? active : (items.find((item) => item.classList.contains("sel")) ?? null);
  const next = adjacentRow(keys, from?.dataset["key"] ?? null, delta);
  if (next === null) return;
  focusAfterPaint = { key: next, until: Date.now() + FOCUS_WAIT_MS };
  const href = items[keys.indexOf(next)]?.dataset["href"];
  if (href !== undefined && href !== location.hash) location.hash = href;
  else schedule();
}

function fold(open: boolean): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const header = active.matches(".group") ? active : active.closest(".rows")?.previousElementSibling;
  const key = header instanceof HTMLElement && header.matches(".group") ? header.dataset["group"] : undefined;
  if (key === undefined) return;
  focusAfterPaint = { key: `group:${key}`, until: Date.now() + FOCUS_WAIT_MS };
  if (state.closed.includes(key) === open) dispatch({ type: "toggle-group", key });
  else schedule();
}

function trapTab(back: boolean): void {
  const items = [...scrim.querySelectorAll<HTMLElement>(TRAPPED)].filter((item) => item.getClientRects().length > 0);
  const active = document.activeElement;
  const next = cycleFocus(active instanceof HTMLElement ? items.indexOf(active) : -1, items.length, back);
  (next === null ? scrim.querySelector<HTMLElement>(".dlg, .palette") : items[next])?.focus();
}

function shortcut(key: ShortcutKey): void {
  const repo = shownRepo();
  const target = repo === null ? null : shortcutTarget(repo, effectivePick(state.route, repo), key);
  if (target !== null) openAction(target.action, target.data);
}

function command(name: KeyCommand): void {
  switch (name) {
    case "palette":
      dispatch({ type: "palette-open" });
      return;
    case "close":
      closeScrim();
      return;
    case "confirm": {
      const guard = state.guardDialog !== null && state.dialog === null;
      const button = scrim.querySelector<HTMLButtonElement>(guard ? '#dlg-foot [data-guard="confirm"]' : '#dlg-foot [data-dlg="confirm"]');
      const planId = button?.dataset["plan"];
      if (button === null || button.disabled || planId === undefined) return;
      dispatch(guard ? { type: "guard-confirm", planId } : { type: "dialog-confirm", planId });
      return;
    }
    case "up":
    case "down":
      dispatch({ type: "palette-move", delta: name === "down" ? 1 : -1, count: palette.count() });
      return;
    case "run-item": {
      const item = palette.chosen();
      if (item !== null) runPaletteItem(item);
      return;
    }
    case "fold":
    case "unfold":
      fold(name === "unfold");
      return;
    case "new":
      openAction("new", {});
      return;
    case "quick":
    case "restack":
    case "ack":
      shortcut(name);
      return;
    case "next":
    case "prev":
      moveSelection(name === "next" ? 1 : -1);
      return;
  }
}

function keyMode(): KeyMode {
  return state.palette !== null ? "palette" : state.dialog !== null || state.guardDialog !== null ? "dialog" : "page";
}

function closeScrim(): void {
  if (state.palette !== null) dispatch({ type: "palette-close" });
  else if (state.dialog !== null) dispatch({ type: "dialog-close" });
  else dispatch({ type: "guard-close" });
}

function onKey(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const typing = target !== null && (target.isContentEditable || (target.matches("input, select, textarea") && !target.matches("input[type=checkbox], input[type=radio]")));
  if (event.repeat && !typing && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    return;
  }
  if (event.key === "Tab" && keyMode() !== "page") {
    event.preventDefault();
    trapTab(event.shiftKey);
    return;
  }
  const input: KeyInput = {
    key: event.key,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    repeat: event.repeat,
    typing,
    submits: target !== null && target.matches("input") && typing,
    onControl: target !== null && target.matches("button, a, select, textarea, summary"),
    onRow: target?.matches(".row") ?? false,
    onGroup: target?.matches(".group") ?? false,
  };
  const name = state.signedOut || event.isComposing ? null : keyCommand(input, keyMode());
  if (name !== null) {
    event.preventDefault();
    command(name);
    return;
  }
  if (keyMode() !== "page" || (event.key !== "Enter" && event.key !== " ") || target === null || target.closest("button, a, input, select, textarea") !== null) return;
  if (target.matches("[data-href], [data-ui]") && activate(target)) event.preventDefault();
}

function tokenDeps(): TokenDeps {
  return {
    hash: location.hash,
    storage: {
      getItem: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          // A page that cannot store the token keeps it for this visit only.
        }
      },
    },
    verify: async (token) => {
      try {
        const response = await fetchImpl("/api/projects", { headers: { "x-grove-token": token }, cache: "no-store", credentials: "omit" });
        return response.status === 200;
      } catch {
        return false;
      }
    },
    replaceHash: (hash) => history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`),
  };
}

function bind(): void {
  document.addEventListener("click", (event) => {
    if (event.target === scrim) {
      closeScrim();
      return;
    }
    if (event.target instanceof Element && !scrim.contains(event.target) && activate(event.target)) event.preventDefault();
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => {
    if (location.hash.includes("token=")) {
      void adoptToken(tokenDeps()).then(() => location.reload());
      return;
    }
    dispatch({ type: "route", route: parseRoute(location.hash) });
  });
}

async function boot(): Promise<void> {
  bind();
  try {
    const dismissed = storage()?.getItem(GUARD_DISMISSED);
    if (isGuardStatus(dismissed)) dispatch({ type: "guard-dismiss", status: dismissed });
  } catch {
    // A page that cannot read storage shows the card.
  }
  schedule();
  navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  const token = await adoptToken(tokenDeps());
  dispatch({ type: "route", route: parseRoute(location.hash) });
  if (token === null) {
    dispatch({ type: "signed-out" });
    return;
  }
  api = createApi(fetchImpl, token);
  connectLive({
    fetchImpl,
    token,
    onEvent: (event) => {
      raise(event);
      dispatch({ type: "event", event, at: Date.now() });
    },
    onState: (live, problem) => dispatch(problem === undefined ? { type: "live", state: live } : { type: "live", state: live, problem }),
    onUnauthorized: () => dispatch({ type: "signed-out" }),
  });
  load();
  window.setInterval(tick, CLOCK_MS);
}

void boot();
