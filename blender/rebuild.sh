#!/bin/sh
# Partial rebuild after geometry-orientation fixes: light/AO/normal passes of some atlases, probes, combine, export,
# compression and the app build.   ./rebuild.sh Atlas1,Atlas2
B="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd "$(dirname "$0")"
F='^[0-9]{2}:[0-9]{2}:[0-9]{2} |rror|Traceback|line [0-9]'
"$B" -b Office_bake.blend -P scripts/run.py -- s5_bake.py --atlas "$1" --passes "${PASSES:-normal,light,ao}" --samples 512 2>&1 | grep --line-buffered -E "$F"
"$B" -b Office_bake.blend -P scripts/run.py -- s5_env.py --samples 512 2>&1 | grep --line-buffered -E "$F"
"$B" -b --factory-startup -P scripts/run.py -- s5_env_web.py 2>&1 | grep --line-buffered -E "$F"
"$B" -b Office_bake.blend -P scripts/run.py -- s5_combine.py --atlas "$1" 2>&1 | grep --line-buffered -E "$F"
"$B" -b Office_bake.blend -P scripts/run.py -- s6_export.py 2>&1 | grep --line-buffered -E "$F" | grep -v INFO
(cd ../tools && node compress.mjs --atlas "$1" 2>&1 | grep -v "^prune")
(cd ../app && npm run build 2>&1 | grep -E "error|built in")
echo REBUILD_DONE
