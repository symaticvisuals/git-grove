import { adoptToken, type TokenDeps } from "./adopt-token.js";
import { announcement } from "./announcement.js";
import { type Api, createApi } from "./api.js";
import { ApiError } from "./api.error.js";
import { effectivePick } from "./effective-pick.js";
import { html, type SafeHtml } from "./html.js";
import { ICONS } from "./icons.js";
import { connectLive } from "./live.js";
import { MESSAGES } from "./messages.js";
import { parseRoute, routeHash } from "./parse-route.js";
import { detailPanel } from "./render/detail-panel.js";
import { mainView } from "./render/main-view.js";
import { sidebar } from "./render/sidebar.js";
import { scanNow } from "./scan-now.js";
import { SLICE_NAMES, type SliceName } from "./slice-names.js";
import { sliceRequests } from "./slice-requests.js";
import { initialState, reduce, type State, type Tab, type UiAction } from "./state.js";
import { timeLabel } from "./time-label.js";
import { toast } from "./toast.js";

declare const __GROVE_VERSION__: string;

const PROJECTS_EVERY_MS = 1_000;
const CLOCK_MS = 5_000;
const TABS: readonly Tab[] = ["feature", "health", "activity"];
const TIME_TEXT = /(<time\b[^>]*>)[^<]*(<\/time>)/g;

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
const inFlight = new Map<SliceName, { key: string; again: boolean }>();
const painted = new Map<string, { stable: string; context: string }>();

function announce(text: string): void {
  const region = document.getElementById("announce");
  if (region === null) return;
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = text;
  }, 50);
}

function dispatch(action: UiAction): void {
  if (action.type === "event" && action.event.type === "digest") for (const flight of inFlight.values()) flight.again = true;
  if (action.type === "route") reveal = true;
  const before = state;
  state = reduce(state, action);
  if (state === before) return;
  const spoken = announcement(before, state, action);
  if (spoken !== null) announce(spoken);
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
    const current = state[slice];
    if (request === null || inFlight.get(slice)?.key === request.key) continue;
    if (current !== null && !(current.status === "loading" || (current.status === "ready" && current.stale))) continue;
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

function focusedKey(region: HTMLElement): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && region.contains(active) ? (active.dataset["key"] ?? null) : null;
}

function put(id: string, content: SafeHtml, context: string): void {
  const region = document.getElementById(id);
  const stable = content.text.replace(TIME_TEXT, "$1$2");
  const last = painted.get(id);
  if (region === null || last?.stable === stable) return;
  const keep = last?.context === context;
  const list = region.querySelector<HTMLElement>(".list");
  const scroll = { region: region.scrollTop, list: list?.scrollTop ?? 0 };
  const focus = focusedKey(region);
  region.innerHTML = content.text;
  painted.set(id, { stable, context });
  if (keep) {
    region.scrollTop = scroll.region;
    const next = region.querySelector<HTMLElement>(".list");
    if (next !== null) next.scrollTop = scroll.list;
  }
  if (focus !== null) region.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

function paint(): void {
  const now = Date.now();
  const { route } = state;
  const loaded = state.repo !== null && state.repo.status !== "loading" ? state.repo.data : null;
  const view = route.view === "repo" && loaded !== null && loaded.project.id === route.repo ? loaded : null;
  const onRepo = route.view === "repo" && !state.signedOut;
  const pick = effectivePick(route, view);
  const header = html`<div class="ws">${ICONS.logo}<b>git grove</b><span class="local">local</span></div>`;
  const side = state.signedOut ? header : sidebar({ route, projects: state.projects, repo: view, live: state.live, now });
  put("side", side, "side");
  put("view", mainView(state, now), `${route.view}:${route.view === "repo" ? route.repo : ""}:${state.tab}`);
  const detail = onRepo ? detailPanel({ repo: state.repo, pick, feature: state.feature, preview: state.preview, now }) : html``;
  put("detail", detail, pick === null || route.view !== "repo" ? "" : routeHash({ ...route, pick }));
  document.getElementById("main")?.classList.toggle("wide", !onRepo);
  document.title = view === null ? "git grove" : `${view.project.name} · git grove`;
  if (reveal && (route.view !== "repo" || view !== null)) {
    reveal = false;
    document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
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

/** The git actions (restore, ack, restack, remove, copy-env, cleanup, new, add-level), opening in an editor or terminal, and the palette: Task 10's dialogs attach here. */
function openAction(_name: string, _data: DOMStringMap): void {}

function scan(element: HTMLElement): void {
  const client = api;
  if (client === null) return;
  const repo = Number(element.dataset["repo"]);
  scanNow({ api: client, repo: Number.isSafeInteger(repo) && repo > 0 ? repo : undefined, now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }).then(
    (result) => toast(result.text, result.ok),
    (error: unknown) => toast(error instanceof ApiError ? error.message : MESSAGES.notRunning, false),
  );
}

function runAction(element: HTMLElement): void {
  const name = element.dataset["action"] ?? "";
  if (name === "scan") scan(element);
  else openAction(name, element.dataset);
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
    if (event.target instanceof Element && activate(event.target)) event.preventDefault();
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if ((event.key !== "Enter" && event.key !== " ") || !(target instanceof HTMLElement) || target.closest("button, a, input, select, textarea") !== null) return;
    if (target.matches("[data-href], [data-ui]") && activate(target)) event.preventDefault();
  });
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
  schedule();
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
    onEvent: (event) => dispatch({ type: "event", event, at: Date.now() }),
    onState: (live, problem) => dispatch(problem === undefined ? { type: "live", state: live } : { type: "live", state: live, problem }),
    onUnauthorized: () => dispatch({ type: "signed-out" }),
  });
  load();
  window.setInterval(tick, CLOCK_MS);
}

void boot();
