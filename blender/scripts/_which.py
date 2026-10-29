# Which object/face is nearest to the given world points (debugging the web build).
#   blender -b Office_bake.blend -P run.py -- _which.py x,y,z [x,y,z ...]
import sys
from mathutils.bvhtree import BVHTree
pts = [Vector(tuple(float(c) for c in a.split(","))) for a in sys.argv[sys.argv.index("--") + 1:]]
dg = bpy.context.evaluated_depsgraph_get()
best = [(1e9, None, None)] * len(pts)
for o in mesh_objects():
    if o.name == VIEW_OBJ:
        continue
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(p[i] for p in bb) for i in range(3)]); hi = Vector([max(p[i] for p in bb) for i in range(3)])
    if not any(all(lo[i] - 0.01 <= p[i] <= hi[i] + 0.01 for i in range(3)) for p in pts):
        continue
    me = o.data
    t = BVHTree.FromPolygons([o.matrix_world @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    for k, p in enumerate(pts):
        loc, nor, idx, d = t.find_nearest(p)
        if loc is not None and d < best[k][0]:
            best[k] = (d, o, idx)
for p, (d, o, idx) in zip(pts, best):
    me = o.data; poly = me.polygons[idx]
    hid = me.attributes["web_hidden"].data[idx].value if "web_hidden" in me.attributes else None
    mat = o.material_slots[poly.material_index].material if o.material_slots else None
    uv = [tuple(round(x, 4) for x in me.uv_layers["BakeUV"].data[li].uv) for li in poly.loop_indices] if "BakeUV" in me.uv_layers else None
    n = (o.matrix_world.to_3x3() @ poly.normal).normalized()
    log(f"{tuple(round(c,4) for c in p)} -> {o.name} poly {idx} d={d:.5f} hidden={hid} mat={mat.name if mat else None} "
        f"atlas={atlas_of_material(o, mat)} n=({n.x:.2f},{n.y:.2f},{n.z:.2f}) uv={uv} faces={len(me.polygons)}")
