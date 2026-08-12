#!/bin/sh

set -eu

repository_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
renderer_binary=$(mktemp /private/tmp/native-cube-social-render.XXXXXX)
trap 'rm -f "$renderer_binary"' EXIT

clang \
  -fobjc-arc \
  -framework AppKit \
  -framework Foundation \
  "$repository_root/scripts/render-social-card.m" \
  -o "$renderer_binary"

if [ "$#" -eq 0 ]; then
  input_svg="$repository_root/assets/social/terraform-modules.svg"
  output_png="$repository_root/assets/social/terraform-modules.png"
elif [ "$#" -eq 2 ]; then
  input_svg="$1"
  output_png="$2"
else
  echo "Usage: render-social-card.sh [INPUT.svg OUTPUT.png]" >&2
  exit 2
fi

"$renderer_binary" "$input_svg" "$output_png"
