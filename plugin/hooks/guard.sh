#!/bin/sh
home="${GIT_GROVE_HOME:-$HOME/.git-grove}"

if [ -r "$home/hook-command" ]; then
  { IFS= read -r node; IFS= read -r bin; } < "$home/hook-command"
  if [ -f "$node" ] && [ -x "$node" ] && [ -f "$bin" ]; then
    exec "$node" "$bin" guard --claude
  fi
fi

if command -v git-grove >/dev/null 2>&1; then
  exec git-grove guard --claude
fi

echo "git grove guard: git grove is not installed or has not run yet; run git grove ui" >&2
exit 0
