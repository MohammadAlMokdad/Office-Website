# Faces that baked black (AO ~ 0) and whose front looks into a closed volume (rays hit back faces) while their back
# side does not: inside-out, the bake looked into the object. Lists them per object and, with --fix, flips them (exactly those faces) and saves.
#   blender -b Office_bake.blend -P run.py -- dark_faces.py [--atlas A,B] [--fix]
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(argv[argv.index("--atlas") + 1].split(",")) if "--atlas" in argv else None
FIX = "--fix" in argv
dg = bpy.context.evaluated_depsgraph_get(); sc = bpy.context.scene
rng = np.random.default_rng(1)
DIRS = rng.normal(size=(24, 3)); DIRS /= np.linalg.norm(DIRS, axis=1, keepdims=True)


def back_hits(p, n, reach=0.06):
    """Fraction of rays leaving p into the hemisphere around n that hit the BACK of a surface within `reach`: a ray
    travelling inside a closed volume does. High in front of an inside-out face (it looks into its own object)."""
    k = 0
    for d in DIRS:
        d = Vector(d)
        if d.dot(n) < 0:
            d = -d
        d = (d + n).normalized()
        ok, loc, hn, *_ = sc.ray_cast(dg, p + n * 1e-4, d, distance=reach)
        k += bool(ok and hn.dot(d) > 0)
    return k / len(DIRS)


ao = {}
report = []
for o in mesh_objects():
    if o.name == VIEW_OBJ or "BakeUV" not in o.data.uv_layers:
        continue
    me = o.data
    hid = np.zeros(len(me.polygons), bool); me.attributes["web_hidden"].data.foreach_get("value", hid)
    slots = [s.material for s in o.material_slots] or [None]
    uvl = me.uv_layers["BakeUV"].data
    M = o.matrix_world; R = M.to_3x3().inverted().transposed()
    dark = []; area = 0.0; tot = 0.0
    for p in me.polygons:
        if hid[p.index]:
            continue
        a = atlas_of_material(o, slots[min(p.material_index, len(slots) - 1)])
        if not a or a == "Vertex" or (ONLY and a not in ONLY):
            continue
        if a not in ao:
            ao[a] = load_pixels(os.path.join(BAKE_DIR, f"{a}_ao.exr"), raw=True)[..., 0]
        img = ao[a]; h, w = img.shape
        uv = np.array([uvl[li].uv for li in p.loop_indices]).mean(0)
        x, y = min(int(uv[0] * w), w - 1), min(int(uv[1] * h), h - 1)
        ar = (M.to_3x3() @ p.normal).length * p.area; tot += ar
        if img[max(y - 1, 0):y + 2, max(x - 1, 0):x + 2].max() > 0.03:
            continue
        c = M @ p.center; n = (R @ p.normal).normalized()
        front, back = back_hits(c, n), back_hits(c, -n)
        if front > 0.6 and back < 0.2:
            dark.append(p.index); area += ar
    if dark:
        report.append((area, o.name, len(dark), area / max(tot, 1e-12), dark))
report.sort(reverse=True)
for area, name, k, frac, idx in report:
    log(f"INSIDE-OUT {name}: {k} faces, {area * 1e4:.1f} cm2 ({frac:.0%} of its baked area)")
if FIX and report:
    for _, name, _, _, idx in report:
        flip_faces(bpy.data.objects[name], idx)
    bpy.ops.wm.save_mainfile(); log("flipped and saved")
