import sys
from mathutils.bvhtree import BVHTree
NAME = sys.argv[sys.argv.index("--") + 1]
o = bpy.data.objects[NAME]; src = bpy.data.objects[NAME + "_HP"]
hb = BVHTree.FromPolygons([v.co for v in src.data.vertices], [tuple(p.vertices) for p in src.data.polygons])
def stats(me):
    me.calc_loop_triangles(); n = len(me.loop_triangles)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    vi = np.empty(n * 3, np.int32); me.loop_triangles.foreach_get("vertices", vi); p = co[vi.reshape(-1, 3)]
    cr = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]); a = 0.5 * np.linalg.norm(cr, axis=1)
    L = np.stack([np.linalg.norm(p[:, 1] - p[:, 0], axis=1), np.linalg.norm(p[:, 2] - p[:, 1], axis=1), np.linalg.norm(p[:, 0] - p[:, 2], axis=1)], 1).max(1)
    thin = (2 * a / np.maximum(L, 1e-12)) < L / 15
    nrm = cr / np.maximum(np.linalg.norm(cr, axis=1, keepdims=True), 1e-12); c = p.mean(1)
    bent = np.zeros(n, bool)
    for i in range(0, n, 1 if n < 60000 else 3):
        loc, hn, idx, d = hb.find_nearest(Vector(c[i]))
        if hn is not None and abs(Vector(nrm[i]).dot(hn)) < 0.94:
            bent[i] = True
    return n, a[thin].sum() / a.sum(), a[bent].sum() / a.sum()
def go():
    n_hp = None
    for tgt in (15000, 30000, 50000, 10**7):
        dg = bpy.context.evaluated_depsgraph_get()
        tmp = src.copy(); tmp.data = src.data.copy(); bpy.context.scene.collection.objects.link(tmp)
        n0 = sum(len(p.vertices) - 2 for p in tmp.data.polygons)
        m = tmp.modifiers.new("d", "DECIMATE"); m.decimate_type = "COLLAPSE"; m.ratio = min(1.0, tgt / n0); m.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
        n, th, be = stats(me)
        log(f"DECIM {NAME} target {tgt}: {n} tris (high-poly {n0}); thin-triangle area {th:.1%}; area bent >20deg from the original {be:.1%}")
        bpy.data.meshes.remove(me); md = tmp.data; bpy.data.objects.remove(tmp); bpy.data.meshes.remove(md)
with_highpoly(go)
