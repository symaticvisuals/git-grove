#!/usr/bin/env bash
# Renders the installable app's icons from docs/brand/mark.svg with headless Chrome, into ui/public/icons.
# Run it once after the mark changes and commit the PNGs. CHROME overrides where Chrome is.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/ui/public/icons"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

ground="#0B0F0E"
mark="$(cat "$root/docs/brand/mark.svg")"

# render <size> <corner radius> <mark share of the size> <png>
render() {
  local size="$1" radius="$2" share="$3" png="$4"
  local page="$work/icon-$size-$radius.html"
  cat > "$page" <<HTML
<!doctype html>
<html><head><style>
html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
.tile{width:${size}px;height:${size}px;border-radius:${radius};background:${ground};display:grid;place-items:center}
.tile svg{width:${share};height:${share}}
</style></head><body><div class="tile">${mark}</div></body></html>
HTML
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$work/profile" --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$size,$size" --screenshot="$png" "file://$page" > /dev/null 2>&1
  [ -s "$png" ] || { echo "render-icons: Chrome wrote no $png" >&2; exit 1; }
}

mkdir -p "$out"
render 192 22% 70% "$out/icon-192.png"
render 512 22% 70% "$out/icon-512.png"
render 512 0 60% "$out/icon-maskable-512.png"
render 32 22% 84% "$work/favicon-32.png"

# favicon.ico: one 32 px PNG behind an ICO header, for whatever asks for /favicon.ico instead of the linked SVG.
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const png = readFileSync(process.argv[1]);
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6);
head.writeUInt8(32, 7);
head.writeUInt16LE(1, 10);
head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14);
head.writeUInt32LE(22, 18);
writeFileSync(process.argv[2], Buffer.concat([head, png]));
' "$work/favicon-32.png" "$root/ui/public/favicon.ico"
echo "render-icons: wrote $(ls "$out" | tr '\n' ' ')and favicon.ico"
