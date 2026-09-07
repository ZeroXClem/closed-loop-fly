#!/usr/bin/env bash
# GPU box helper. Source of truth is this checkout; the GPU box gets an rsync mirror.
# Point it at your machine with GPU_BOX_HOST=user@host (and GPU_BOX_DIR, default
# projects/closedloopfly) in the environment, or in the git-ignored scripts/gpu-box.local,
# which is sourced if present.
#   scripts/gpu-box.sh sync            mirror the repo (vendor + LFS objects included, no node_modules)
#   scripts/gpu-box.sh run <cmd...>    run a command in the mirror, inside `nix develop`
#   scripts/gpu-box.sh runx <cmd...>   same, under xvfb-run (WebGL + WebGPU in one page needs a display)
#   scripts/gpu-box.sh raw <cmd...>    same, without the devShell
#   scripts/gpu-box.sh bg <cmd...>     like runx, detached on the box (survives ssh); log in bench/out/bg.log there
#   scripts/gpu-box.sh pull <path>     copy a file/dir from the mirror back here (bench/out/ is never synced or deleted)
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$HERE/scripts/gpu-box.local" ] && . "$HERE/scripts/gpu-box.local"
HOST=${GPU_BOX_HOST:?set GPU_BOX_HOST=user@host in the environment or in scripts/gpu-box.local}
REMOTE=${GPU_BOX_DIR:-projects/closedloopfly}
case "${1:-}" in
  sync)
    ssh "$HOST" "mkdir -p $REMOTE"
    rsync -az --delete --info=stats1 \
      --exclude node_modules --exclude dist --exclude .vite --exclude result --exclude 'bench/out/' --exclude 'docs/*.webm' \
      --exclude '.git/lfs' --exclude 'scripts/gpu-box.local' \
      "$HERE/" "$HOST:$REMOTE/" ;;
  run) shift; ssh "$HOST" "cd $REMOTE && nix develop -c bash -c $(printf %q "$*")" ;;
  runx) shift; ssh "$HOST" "cd $REMOTE && xvfb-run -a -s '-screen 0 ${XVFB_SCREEN:-1280x800x24}' nix develop -c bash -c $(printf %q "$*")" ;;
  raw) shift; ssh "$HOST" "cd $REMOTE && $*" ;;
  bg) shift; ssh "$HOST" "cd $REMOTE && setsid -f bash -c 'xvfb-run -a -s \"-screen 0 ${XVFB_SCREEN:-1280x800x24}\" nix develop -c bash -c $(printf %q "$*") > bench/out/bg.log 2>&1' && echo started" ;;
  pull) shift; rsync -az "$HOST:$REMOTE/$1" "$HERE/$1" ;;
  *) sed -n 2,11p "$0"; exit 1 ;;
esac
