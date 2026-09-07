#!/usr/bin/env bash
# GPU box helper. Source of truth is this checkout; gpu-box gets an rsync mirror.
#   scripts/gpu-box.sh sync            mirror the repo (vendor + LFS objects included, no node_modules/.venv)
#   scripts/gpu-box.sh run <cmd...>    run a command in the mirror, inside `nix develop`
#   scripts/gpu-box.sh raw <cmd...>    same, without the devShell
#   scripts/gpu-box.sh pull <path>     copy a file/dir from the mirror back here
set -euo pipefail
HOST=${GPU_BOX_HOST:-user@gpu-box}
REMOTE=${GPU_BOX_DIR:-projects/closedloopfly}
HERE=$(cd "$(dirname "$0")/.." && pwd)
case "${1:-}" in
  sync)
    ssh "$HOST" "mkdir -p $REMOTE"
    rsync -az --delete --info=stats1 \
      --exclude node_modules --exclude dist --exclude .vite --exclude result \
      --exclude '.git/lfs' \
      "$HERE/" "$HOST:$REMOTE/" ;;
  run) shift; ssh "$HOST" "cd $REMOTE && nix develop -c bash -c $(printf %q "$*")" ;;
  raw) shift; ssh "$HOST" "cd $REMOTE && $*" ;;
  pull) shift; rsync -az "$HOST:$REMOTE/$1" "$HERE/$1" ;;
  *) sed -n 2,6p "$0"; exit 1 ;;
esac
