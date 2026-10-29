# Background launcher: runs web_lib.py and a pipeline script in one namespace.
#   blender -b <file.blend> -P scripts/run.py -- <script.py> [script args...]
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:]
script = os.path.join(here, argv[0])
sys.argv = [script, "--"] + argv[1:]            # the script sees only its own arguments after "--"
ns = {"__name__": "__main__", "__file__": script}
for path in (os.path.join(here, "web_lib.py"), script):
    with open(path, encoding="utf-8") as f:
        exec(compile(f.read(), path, "exec"), ns)
