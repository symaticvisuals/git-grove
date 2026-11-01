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

repo="$work/repo"
mkdir "$repo"
git -C "$repo" init --quiet
cd "$repo"

actual="$(git grove --version)"
echo "$actual"
[ "$actual" = "git-grove 0.1.0" ] || { echo "expected: git-grove 0.1.0" >&2; exit 1; }
