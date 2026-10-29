# Rasterize an atlas's BakeUV layout to build/renders/uv_<atlas>.png and print per-object texel density.
ATL = globals().get("DEBUG_ATLAS", "Electrical")
N = 1024
img = np.zeros((N, N), np.float32)
size = ATLAS[ATL]
for o in mesh_objects():
    if o.name == VIEW_OBJ or "BakeUV" not in o.data.uv_layers: continue
    me = o.data
    slots = [s.material for s in o.material_slots] or [None]
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
    hid = np.zeros(len(me.polygons), bool); me.attributes["web_hidden"].data.foreach_get("value", hid)
    mask = np.array([atlas_of_material(o, slots[min(i, len(slots) - 1)]) == ATL for i in mi]) & ~hid
    if not mask.any(): continue
    me.calc_loop_triangles()
    t = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("loops", t); t = t.reshape(-1, 3)
    p = np.empty(len(me.loop_triangles), np.int32); me.loop_triangles.foreach_get("polygon_index", p)
    t = t[mask[p]]
    l = me.uv_layers["BakeUV"]; a = np.empty(len(l.data) * 2, np.float32); l.data.foreach_get("uv", a); a = a.reshape(-1, 2)
    ua = 0.0
    for tri in t:
        q = a[tri] * (N - 1)
        x0, y0 = np.floor(q.min(0)).astype(int); x1, y1 = np.ceil(q.max(0)).astype(int)
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, N - 1) + 1), np.arange(max(y0, 0), min(y1, N - 1) + 1))
        P = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
        A, B, C = q
        def s(p1, p2, pts): return (p2[0] - p1[0]) * (pts[:, 1] - p1[1]) - (p2[1] - p1[1]) * (pts[:, 0] - p1[0])
        d1, d2, d3 = s(A, B, P), s(B, C, P), s(C, A, P)
        ins = ((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))
        img[ys.ravel()[ins], xs.ravel()[ins]] += 1
        ua += 0.5 * abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / (N - 1) ** 2
    ar = np.empty(len(me.polygons)); me.polygons.foreach_get("area", ar)
    wa = ar[mask].sum() * abs(o.matrix_world.to_3x3().determinant()) ** (2 / 3)
    print(f"  {o.name:30s} world {wa:7.3f} m2  uv {ua:.4f}  -> {size * math.sqrt(ua / max(wa, 1e-12)):6.0f} px/m")
cov = (img > 0).mean(); over = (img > 1).mean()
print(f"{ATL}: covered {cov:.1%}, overlapping {over:.2%}")
rgba = np.zeros((N, N, 4), np.float32); rgba[..., 0] = np.clip(img, 0, 1); rgba[..., 1] = (img > 1); rgba[..., 3] = 1
im = bpy.data.images.new("uvdbg", N, N); im.pixels.foreach_set(rgba.ravel())
im.filepath_raw = os.path.join(RENDER_DIR, f"uv_{ATL}.png"); im.file_format = "PNG"; im.save(); bpy.data.images.remove(im)
