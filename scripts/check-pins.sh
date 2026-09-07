#!/usr/bin/env bash
# The flake inputs and the git submodules must point at the same upstream commits.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { # name submodule-path flake-input-name
  local sub; sub=$(git -C "$2" rev-parse HEAD)
  local flake; flake=$(nix flake metadata --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['locks']['nodes']['$3']['locked']['rev'])")
  if [ "$sub" = "$flake" ]; then echo "ok    $1 $sub"; else echo "DRIFT $1: submodule $sub, flake input $3 $flake"; fail=1; fi
}
check xenova vendor/fruit-fly-simulation xenova
check abijah-research vendor/fruit-fly-brain-research abijah-research
check abijah-data vendor/fruit-fly-brain abijah-data
exit $fail
