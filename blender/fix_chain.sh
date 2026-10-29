#!/bin/sh
# Rebuild after the orientation reset + user feedback (2026-10-22): flips, scene edits, UVs, bakes, reflections, export.
B="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd "$(dirname "$0")"
F='^[0-9]{2}:[0-9]{2}:[0-9]{2} |rror|Traceback|line [0-9]|OVERLAP'
run() { "$B" -b Office_bake.blend -P scripts/run.py -- "$@" 2>&1 | grep --line-buffered -E "$F" | grep -v INFO; }
run _apply_and_save.py
run s7_scene_edits.py
run s4_uv.py --atlas IslandAli,IslandSalah,Lounge,WindowDesks,Alpha
run uv_overlap.py --atlas IslandAli,IslandSalah,Lounge,WindowDesks,Alpha
run s5_bake.py --atlas IslandAli,IslandSalah,Lounge,WindowDesks,TVWall,Electrical,Alpha --passes normal,albedo,emit,light,ao,f0,rough,alpha --samples 512
run s5_bake.py --atlas Floor,Structure --passes f0,rough --samples 512
run s5_env.py --samples 512
"$B" -b --factory-startup -P scripts/run.py -- s5_env_web.py 2>&1 | grep --line-buffered -E "$F"
run s5_combine.py
run s6_export.py
(cd ../tools && node compress.mjs --atlas IslandAli,IslandSalah,Lounge,WindowDesks,TVWall,Electrical,Alpha,Floor,Structure 2>&1 | grep -v "^prune")
(cd ../app && npm run build 2>&1 | grep -E "error|built in")
echo FIX_CHAIN_DONE
