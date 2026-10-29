# Step 2b (live): parts modelled inside out get their faces flipped.
#   python bl.py s2_fix_normals.py 1800 --lib
# Cycles renders shade whichever side faces the camera, so inverted normals never show in Blender, but a bake lights
# the side the normal points to: inside-out parts bake black. Per connected piece of each mesh, the area-weighted
# "divergence" sum((face centre - piece centre) . normal * area) is positive when normals point outwards (for a closed
# piece it is 3x its volume); clearly negative pieces are flipped (Blender's flip keeps custom normals consistent).
live_guard()
THRESHOLD = -0.25           # normalised divergence below which a piece counts as inside out
MIN_FACES = 4               # single quads / flat decals give no reliable answer


def inside_out_faces(o):
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    seen = np.zeros(len(bm.faces), bool); flip = []
    for f0 in bm.faces:
        if seen[f0.index]:
            continue
        stack = [f0]; seen[f0.index] = True; comp = []
        while stack:
            f = stack.pop(); comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if not seen[g.index]:
                        seen[g.index] = True; stack.append(g)
        if len(comp) < MIN_FACES:
            continue
        c = np.array([f.calc_center_median() for f in comp]); n = np.array([f.normal for f in comp])
        a = np.array([f.calc_area() for f in comp]); C = (c * a[:, None]).sum(0) / max(a.sum(), 1e-12)
        d = c - C
        div = ((d * n).sum(1) * a).sum(); norm = (np.linalg.norm(d, axis=1) * a).sum()
        if norm > 1e-12 and div / norm < THRESHOLD:
            flip.extend(f.index for f in comp)
    bm.free()
    return flip


if bpy.context.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
report = []
for o in mesh_objects():
    if o.name == VIEW_OBJ or {c.name for c in o.users_collection} & {"Structure"}:
        continue
    idx = inside_out_faces(o)
    if not idx:
        continue
    me = o.data
    sel = np.zeros(len(me.polygons), bool); sel[idx] = True
    me.polygons.foreach_set("select", sel); me.update()
    with override([o], o):
        select_only([o])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bpy.ops.mesh.flip_normals()
        bpy.ops.object.mode_set(mode="OBJECT")
    me.polygons.foreach_set("select", np.ones(len(me.polygons), bool)); me.update()
    o["web_flipped"] = len(idx)
    report.append((o.name, group_of(o), len(idx), len(me.polygons)))
for r in report:
    log(f"  flipped {r[0]} ({r[1]}): {r[2]} of {r[3]} faces")
log(f"inside-out fix: {len(report)} objects, atlases to re-bake: {sorted({r[1] for r in report})}")
bpy.ops.wm.save_mainfile()
