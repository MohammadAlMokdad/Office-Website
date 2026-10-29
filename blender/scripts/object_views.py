# Close-up camera views of named objects (for check.mjs --views / check_views.py), written as a views JSON.
#   blender -b Office_bake.blend -P run.py -- object_views.py out.json Name1,Name2,...
import sys, json
argv = sys.argv[sys.argv.index("--") + 1:]
out, names = argv[0], argv[1].split(",")
views = {"_": "close-ups of single objects, [eye x, y, z, target x, y, z, lens mm]"}
for n in names:
    o = bpy.data.objects[n]
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]; c = sum(pts, Vector()) / 8; r = max((p - c).length for p in pts)
    d = Vector((CENTER.x - c.x, CENTER.y - c.y, 0)).normalized()
    d = (d + Vector((0, 0, 0.8))).normalized()
    eye = c + d * max(r / math.tan(math.atan(12 / 35)) * 1.3, 0.25)
    eye.z = min(eye.z, CEIL_Z - 0.1)
    views[n] = [round(x, 4) for x in (*eye, *c)] + [35]
json.dump(views, open(out, "w"), indent=1)
log("views:", len(views) - 1)
