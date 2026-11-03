#!/bin/sh
home="${GIT_GROVE_HOME:-$HOME/.git-grove}"
mode="--claude"
[ "$1" = "--announce" ] && mode="--announce"

if [ -r "$home/hook-command" ]; then
  { IFS= read -r node; IFS= read -r bin; } < "$home/hook-command"
  if [ -f "$node" ] && [ -x "$node" ] && [ -f "$bin" ]; then
    exec "$node" "$bin" guard "$mode"
  fi
fi

if command -v git-grove >/dev/null 2>&1; then
  exec git-grove guard "$mode"
fi

[ "$mode" = "--claude" ] && echo "git grove guard: git grove is not installed or has not run yet; run git grove ui" >&2
exit 0
