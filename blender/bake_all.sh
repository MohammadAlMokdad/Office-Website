#!/bin/sh
# Full bake + export: atlases (512 samples), cables' vertex colours, final textures, GLB / scene.json / collision.json.
#   ./bake_all.sh [Atlas1,Atlas2,...]     (default: every atlas)
B="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd "$(dirname "$0")"
ATLASES="${1:-Floor,IslandAli,WindowDesks,Structure,IslandSalah,Lounge,TVWall,Ceiling,Electrical,Lighting,Alpha}"
F='^[0-9]{2}:[0-9]{2}:[0-9]{2} |rror|Traceback|line [0-9]'
"$B" -b Office_bake.blend -P scripts/run.py -- s5_bake.py --atlas "$ATLASES" --samples 512 2>&1 | grep --line-buffered -E "$F" || exit 1
"$B" -b Office_bake.blend -P scripts/run.py -- s5_bake.py --vertex --samples 512 2>&1 | grep --line-buffered -E "$F"
"$B" -b Office_bake.blend -P scripts/run.py -- s5_combine.py 2>&1 | grep --line-buffered -E "$F"
"$B" -b Office_bake.blend -P scripts/run.py -- s6_export.py 2>&1 | grep --line-buffered -E "$F" | grep -v INFO
echo BAKE_ALL_DONE
