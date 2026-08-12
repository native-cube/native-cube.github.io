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

"$renderer_binary" \
  "$repository_root/assets/social/terraform-modules.svg" \
  "$repository_root/assets/social/terraform-modules.png"
