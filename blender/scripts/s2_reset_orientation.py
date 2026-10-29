# Repair (background, saves the bake file): every mesh back to the orientation of the untouched sources.
#   blender -b Office_bake.blend -P run.py -- s2_reset_orientation.py
# Simplified objects are rebuilt from their _HighPoly originals; every other face whose normal points the other way
# than in Office.blend (build/source_normals.npz) is flipped back. Undoes all earlier inside-out "fixes".
src = np.load(os.path.join(BUILD, "source_normals.npz"))
def go():
    out = []
    for o in mesh_objects():
        if bpy.data.objects.get(o.name + "_HP"):
            t = int(o.get("web_target", 0)) or tris(o)
            simplify(o, t, "ANGLE"); out.append(o.name)
    return out
rebuilt = with_highpoly(go)
flipped, skipped = [], []
for o in mesh_objects():
    if o.name in rebuilt or o.name not in src.files or o.get("web_cup_inner"):   # cups: inside-out in the source
        continue
    ref = src[o.name]; me = o.data
    if len(ref) != len(me.polygons):
        skipped.append(o.name); continue
    cur = np.empty(len(me.polygons) * 3, np.float32); me.polygons.foreach_get("normal", cur); cur = cur.reshape(-1, 3)
    bad = np.nonzero((cur * ref).sum(1) < 0)[0]
    if len(bad):
        flip_faces(o, bad); flipped.append(f"{o.name} {len(bad)}/{len(me.polygons)}")
for o in bpy.data.objects:
    if "web_flipped" in o:
        del o["web_flipped"]
log(f"orientation reset: rebuilt {len(rebuilt)} simplified objects; flipped back {flipped}; skipped (topology differs) {skipped}")
bpy.ops.wm.save_mainfile()
