#!/usr/bin/env bash
# Builds a throwaway repository, loses work in it the way an agent can, and shows git grove catching it.
# Run after `pnpm install && pnpm build`. Everything lives in one temp folder; nothing global is installed or read.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
bin="$root/dist/cli/bin.js"
[ -f "$bin" ] || { echo "dist/cli/bin.js is missing: run pnpm build first" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/git-grove-demo.XXXXXX")"
work="$(cd "$work" && pwd -P)"
repo="$work/acme-shop"

# grove's folder, HOME, Claude Code's folder and git config all point into the temp folder, so the demo never reads
# or writes your own.
export GIT_GROVE_HOME="$work/grove-home"
export GIT_GROVE_NO_OPEN=1
export HOME="$work/user"
export CLAUDE_CONFIG_DIR="$work/claude"
export GIT_CONFIG_GLOBAL="$work/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Robin Example" GIT_AUTHOR_EMAIL="robin@example.com"
export GIT_COMMITTER_NAME="Robin Example" GIT_COMMITTER_EMAIL="robin@example.com"
mkdir -p "$HOME"
: > "$GIT_CONFIG_GLOBAL"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { echo "demo: $1" >&2; exit 1; }
grove() { echo "\$ git grove $*"; node "$bin" "$@"; }
commit_file() {
  mkdir -p "$(dirname "$1/$2")"
  echo "$3" > "$1/$2"
  git -C "$1" add -- "$2"
  git -C "$1" commit --quiet -m "$4"
}
add_level() {
  local folder="$repo/.worktrees/checkout-coupons/$1" branch="$2" parent="$3"
  git -C "$repo" worktree add --quiet -b "$branch" "$folder" "$parent"
  git -C "$repo" config "branch.$branch.stackparent" "$parent"
  git -C "$repo" config "branch.$branch.stackforkpoint" "$(git -C "$repo" rev-parse "$parent")"
}

step "1/7 Build acme-shop: a main branch, a merged worktree and a three-level stack"
echo "in $repo"
git init --quiet -b main "$repo"
git -C "$repo" config stack.trunk main
commit_file "$repo" .gitignore $'.worktrees/\n.local/' "ignore worktrees and local files"
commit_file "$repo" README.md "acme-shop" "start acme-shop"

old="$repo/.worktrees/old-onboarding"
git -C "$repo" worktree add --quiet -b feat/onboarding-copy "$old" main
commit_file "$old" onboarding.md "Welcome to acme-shop" "rewrite the onboarding copy"
git -C "$repo" merge --quiet --ff-only feat/onboarding-copy

add_level 01-feat-coupons-model feat/coupons-model main
git -C "$repo" config branch.feat/coupons-model.grovefeature "checkout coupons"
model="$repo/.worktrees/checkout-coupons/01-feat-coupons-model"
commit_file "$model" src/coupon.ts "export type Coupon = { code: string };" "add the coupon model"

add_level 02-feat-coupons-ui feat/coupons-ui feat/coupons-model
ui="$repo/.worktrees/checkout-coupons/02-feat-coupons-ui"
commit_file "$ui" src/coupon-field.ts "export const field = 'code';" "add the coupon field"
commit_file "$ui" src/coupon-errors.ts "export const expired = 'This code has expired';" "show coupon errors"
commit_file "$ui" src/coupon-summary.ts "export const summary = 'You save';" "show the saving in the summary"

add_level 03-feat-coupons-email feat/coupons-email feat/coupons-ui
email="$repo/.worktrees/checkout-coupons/03-feat-coupons-email"
commit_file "$email" src/coupon-email.ts "export const subject = 'Your coupon';" "email the coupon"

echo "The stack is gh-stack's git config, which grove reads (each level's fork point is recorded too):"
git -C "$repo" config --get-regexp '^(stack\.trunk|branch\..*\.(stackparent|grovefeature))$'

step "2/7 First status: grove records where every branch is"
cd "$repo"
grove status

step "3/7 An agent squashes level 02 into one commit by accident"
echo "\$ git reset --soft feat/coupons-model && git commit -m 'coupons ui'   (in 02-feat-coupons-ui)"
git -C "$ui" reset --quiet --soft feat/coupons-model
git -C "$ui" commit --quiet -m "coupons ui"
git -C "$ui" log --oneline feat/coupons-model..feat/coupons-ui

step "4/7 A merged worktree still holds the only copy of an ignored seed file"
mkdir -p "$old/.local"
echo "insert into coupons values ('WELCOME10', 10);" > "$old/.local/seed.sql"
echo "$ git -C .worktrees/old-onboarding status --short   (says nothing: .local/ is ignored)"
git -C "$old" status --short

step "5/7 Second status: grove shows the rewrite and the unsafe worktree"
report="$(grove status)"
echo "$report"
grep -q "History rewritten" <<< "$report" || fail "expected status to report the rewrite"
grep -q "Merged, but not safe to remove" <<< "$report" || fail "expected status to report the unsafe worktree"

step "6/7 Is the merged worktree safe to remove? grove says no, exit 3, names the file, and the guard stops an agent"
code=0
check="$(grove check remove .worktrees/old-onboarding)" || code=$?
echo "$check"
echo "(exit $code)"
[ "$code" = 3 ] || fail "expected check remove to exit 3, got $code"
grep -q ".local/seed.sql" <<< "$check" || fail "expected check remove to name .local/seed.sql"
echo
echo "An agent tries anyway. Claude Code's PreToolUse hook hands the command to the guard, which blocks it (exit 2):"
echo "\$ git worktree remove --force .worktrees/old-onboarding   (seen by: git grove guard --claude)"
hook="{\"session_id\":\"demo\",\"cwd\":\"$repo\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git worktree remove --force .worktrees/old-onboarding\"}}"
code=0
guarded="$(node "$bin" guard --claude <<< "$hook" 2>&1)" || code=$?
echo "$guarded"
echo "(exit $code)"
[ "$code" = 2 ] || fail "expected the guard to exit 2, got $code"
grep -q "git grove rm --rescue .worktrees/old-onboarding" <<< "$guarded" || fail "expected the guard to offer rm --rescue"

step "7/7 Put things right: restore the branch, rescue the file, remove the worktree"
grove restore feat/coupons-ui
git -C "$ui" log --oneline feat/coupons-model..feat/coupons-ui
[ "$(git rev-list --count feat/coupons-model..feat/coupons-ui)" = 3 ] || fail "expected the three commits back"
grove rm --rescue .worktrees/old-onboarding
[ -f "$repo/.local/seed.sql" ] || fail "expected .local/seed.sql rescued into the main worktree"
[ ! -e "$old" ] || fail "expected the old-onboarding folder removed"
echo "\$ cat .local/seed.sql"
cat "$repo/.local/seed.sql"
report="$(grove status)"
echo "$report"
if grep -q "Needs you" <<< "$report"; then fail "expected nothing left that needs you"; fi

cat > "$work/dashboard-url.sh" << EOF
#!/usr/bin/env bash
# Prints the address of the dashboard serving this demo, with grove's token in the fragment.
set -euo pipefail
port="\$(node -p 'require(process.argv[1]).port' "$GIT_GROVE_HOME/server.json")"
echo "http://127.0.0.1:\$port/#token=\$(cat "$GIT_GROVE_HOME/token")"
EOF

cat << EOF

Done. The scenario stays in $work.

To see it in the dashboard, serve it from this terminal (Ctrl-C stops it). Its HOME and Claude Code folder are the
demo's, so installing the agent guard there edits only $CLAUDE_CONFIG_DIR/settings.json:
  HOME="$HOME" CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" GIT_GROVE_HOME="$GIT_GROVE_HOME" node "$bin" serve
serve prints its address without the token, and the page needs the token. In a second terminal, this prints
the address to open, token included:
  bash "$work/dashboard-url.sh"
The demo uses serve rather than git grove ui, because ui installs a login service.
Delete $work when you are done.
EOF
