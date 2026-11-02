#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
serve_pid=""
stop_serve() { [ -z "$serve_pid" ] || kill -KILL "$serve_pid" 2> /dev/null || true; }
trap 'stop_serve; rm -rf "$work"' EXIT

cd "$root"
pnpm build
tarball="$(npm pack --pack-destination "$work" --silent | tail -n 1)"

npm install --prefix "$work/prefix" --silent "$work/$tarball"
export PATH="$work/prefix/node_modules/.bin:$PATH"
installed="$work/prefix/node_modules/$(node -p 'require("./package.json").name')"
for file in dist/ui/index.html dist/ui/app.js dist/ui/sw.js dist/ui/manifest.webmanifest dist/ui/icons/icon-512.png; do
  [ -f "$installed/$file" ] || { echo "expected $file in the installed package" >&2; exit 1; }
done

# A throwaway home, Claude Code folder, grove home and git config, so the check never touches the user's own.
export HOME="$work/user"
mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$work/claude"
export GIT_GROVE_HOME="$work/home"
export GIT_GROVE_NO_OPEN=1
export GIT_CONFIG_GLOBAL="$work/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Smoke Test" GIT_AUTHOR_EMAIL="smoke@example.com"
export GIT_COMMITTER_NAME="Smoke Test" GIT_COMMITTER_EMAIL="smoke@example.com"
: > "$GIT_CONFIG_GLOBAL"

repo="$work/repo"
mkdir "$repo"
git -C "$repo" init --quiet -b main
cd "$repo"

actual="$(git grove --version)"
echo "$actual"
[ "$actual" = "git-grove 0.2.0" ] || { echo "expected: git-grove 0.2.0" >&2; exit 1; }

git config stack.trunk main
echo base > base.txt && git add base.txt && git commit --quiet -m base
git switch --quiet -c feat
for n in 1 2 3; do
  echo "$n" > "f$n.txt" && git add "f$n.txt" && git commit --quiet -m "add f$n"
done

# The first status only records each branch's tip; the squash after it is what gets journaled.
git grove status > /dev/null
git reset --quiet --soft main
git commit --quiet -m "squash feat"

report="$(git grove status 2> "$work/stderr")"
echo "$report"
grep -qi "history rewritten" <<< "$report" || { echo "expected: history rewritten" >&2; exit 1; }
[ ! -s "$work/stderr" ] || { echo "expected no stderr, got:" >&2; cat "$work/stderr" >&2; exit 1; }

# The installed guard blocks a worktree removal that would lose an ignored file, and install-guard names the installed bin.
echo ".local/" >> "$(git rev-parse --git-common-dir)/info/exclude"
git worktree add --quiet "$work/seeded" -b seeded main
mkdir "$work/seeded/.local" && echo "insert;" > "$work/seeded/.local/seed.sql"
hook="{\"session_id\":\"smoke\",\"cwd\":\"$repo\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git worktree remove --force $work/seeded\"}}"
code=0
git-grove guard --claude <<< "$hook" > "$work/guard.out" 2> "$work/guard.err" || code=$?
[ "$code" = 2 ] || { echo "expected the guard to exit 2, got $code:" >&2; cat "$work/guard.err" >&2; exit 1; }
[ ! -s "$work/guard.out" ] || { echo "expected no stdout from the guard" >&2; exit 1; }
grep -q ".local/seed.sql" "$work/guard.err" || { echo "expected the guard to name .local/seed.sql" >&2; exit 1; }
git grove install-guard | grep -qF "$(cd "$installed" && pwd -P)/dist/cli/bin.js guard --claude" || { echo "expected install-guard to print the installed bin" >&2; exit 1; }
echo "guard: ok"

# serve: answers its health, guards the API, shows in status, and exits by itself: 0 on SIGTERM, 75 on /api/shutdown.
# It runs as git-grove, not through git, so the signal and the exit code are the server's own.
start_serve() {
  git-grove serve --port 0 > "$work/serve.out" 2>&1 &
  serve_pid=$!
  for _ in $(seq 100); do
    [ -s "$GIT_GROVE_HOME/server.json" ] && break
    kill -0 "$serve_pid" 2> /dev/null || { echo "serve exited early:" >&2; cat "$work/serve.out" >&2; exit 1; }
    sleep 0.1
  done
  port="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).port)' "$GIT_GROVE_HOME/server.json")"
}

wait_serve() {
  for _ in $(seq 100); do
    kill -0 "$serve_pid" 2> /dev/null || break
    sleep 0.1
  done
  kill -0 "$serve_pid" 2> /dev/null && { echo "serve did not exit within 10 s" >&2; exit 1; }
  code=0
  wait "$serve_pid" || code=$?
  serve_pid=""
  [ "$code" = "$1" ] || { echo "expected serve to exit $1, got $code:" >&2; cat "$work/serve.out" >&2; exit 1; }
}

status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

start_serve
echo "serving on port $port"
[ "$(status_of "http://127.0.0.1:$port/api/health")" = 200 ] || { echo "expected /api/health 200" >&2; exit 1; }
[ "$(status_of "http://127.0.0.1:$port/api/projects")" = 401 ] || { echo "expected /api/projects 401 without the token" >&2; exit 1; }
[ "$(status_of "http://127.0.0.1:$port/manifest.webmanifest")" = 200 ] || { echo "expected the manifest" >&2; exit 1; }
git grove status | tail -n 1 | grep -qx "Dashboard: http://127.0.0.1:$port/" || { echo "expected status to end with the dashboard" >&2; exit 1; }
kill -TERM "$serve_pid"
wait_serve 0
[ ! -e "$GIT_GROVE_HOME/server.json" ] || { echo "expected server.json removed after SIGTERM" >&2; exit 1; }

start_serve
token="$(cat "$GIT_GROVE_HOME/token")"
answer="$(status_of -X POST -H "X-Grove-Token: $token" -H "Content-Type: application/json" --data '{}' "http://127.0.0.1:$port/api/shutdown")"
[ "$answer" = 202 ] || { echo "expected /api/shutdown 202, got $answer" >&2; exit 1; }
wait_serve 75
echo "serve: ok"
