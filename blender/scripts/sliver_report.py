# Simplified objects whose triangles bake badly: share of the surface in triangles thinner than one atlas texel in
# BakeUV (the bake cannot fill them: speckles and dashed lines), and high-poly face counts for comparison.
#   blender -b Office_bake.blend -P run.py -- sliver_report.py
rows = []
for o in mesh_objects():
    hp = bpy.data.objects.get(o.name + "_HP")
    if o.name == VIEW_OBJ or "BakeUV" not in o.data.uv_layers or hp is None:
        continue
    me = o.data; me.calc_loop_triangles()
    slots = [s.material for s in o.material_slots] or [None]
    size = max((ATLAS.get(atlas_of_material(o, s) or "", 0) for s in slots), default=0) or 4096
    n = len(me.loop_triangles)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    vi = np.empty(n * 3, np.int32); me.loop_triangles.foreach_get("vertices", vi); vi = vi.reshape(-1, 3)
    li = np.empty(n * 3, np.int32); me.loop_triangles.foreach_get("loops", li); li = li.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers["BakeUV"].data.foreach_get("uv", uv); uv = uv.reshape(-1, 2) * size
    p = co[vi]; a3 = 0.5 * np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)
    q = uv[li]; e = np.stack([q[:, 1] - q[:, 0], q[:, 2] - q[:, 1], q[:, 0] - q[:, 2]], 1)
    a2 = 0.5 * np.abs(e[:, 0, 0] * e[:, 1, 1] - e[:, 0, 1] * e[:, 1, 0])
    hmin = 2 * a2 / np.maximum(np.linalg.norm(e, axis=2).max(1), 1e-9)      # smallest height of the UV triangle
    thin = hmin < 1.0
    frac = a3[thin].sum() / max(a3.sum(), 1e-12)
    rows.append((frac, o.name, n, len(hp.data.polygons), int(o.get("web_target", 0)), a3[thin].sum() * 1e4))
rows.sort(reverse=True)
for frac, name, n, nhp, tgt, cm2 in rows[:25]:
    log(f"SLIVER {name}: {frac:.1%} of surface ({cm2:.0f} cm2) in sub-texel triangles; {n} tris now, {nhp} faces high-poly, target {tgt}")
