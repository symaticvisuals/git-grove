#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$root"
pnpm build
tarball="$(npm pack --pack-destination "$work" --silent | tail -n 1)"

npm install --prefix "$work/prefix" --silent "$work/$tarball"
export PATH="$work/prefix/node_modules/.bin:$PATH"

# A throwaway grove home and git config, so the check never touches the user's own.
export GIT_GROVE_HOME="$work/home"
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
[ "$actual" = "git-grove 0.1.0" ] || { echo "expected: git-grove 0.1.0" >&2; exit 1; }

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

report="$(git grove status)"
echo "$report"
grep -qi "history rewritten" <<< "$report" || { echo "expected: history rewritten" >&2; exit 1; }
