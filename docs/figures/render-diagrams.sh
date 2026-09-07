#!/usr/bin/env bash
# Render the two hand-drawn SVG diagrams to 3200 x 1800 PNGs with a headless Chromium-family browser.
set -euo pipefail
cd "$(dirname "$0")"
B=${BROWSER:-$(command -v brave || command -v chromium || command -v google-chrome)}
for n in loop-ring dng02-wiring; do
  "$B" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --use-angle=swiftshader --window-size=3200,1800 --screenshot="$PWD/$n.png" "file://$PWD/$n.html" >/dev/null 2>&1
  echo "wrote docs/figures/$n.png"
done
