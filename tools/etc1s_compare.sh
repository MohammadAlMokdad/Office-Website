#!/bin/sh
# Swap ETC1S test textures (build/etc1s_test/*.ktx2) into the built site, screenshot, then restore the originals.
#   ./etc1s_compare.sh Floor Structure WindowView
cd "$(dirname "$0")"
D=../app/dist/models/textures
mkdir -p ../build/etc1s_backup
for n in "$@"; do cp "$D/$n.ktx2" "../build/etc1s_backup/$n.ktx2"; cp "../build/etc1s_test/$n.ktx2" "$D/$n.ktx2"; done
node check.mjs http://localhost:4173/ --tag etc1s 2>&1 | grep -E "view [0-9]"
node check.mjs http://localhost:4173/ --tag etc1s_close --close 2>&1 | grep -E "view [0-9]"
for n in "$@"; do cp "../build/etc1s_backup/$n.ktx2" "$D/$n.ktx2"; done
echo restored
