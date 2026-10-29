# Per-object UV overlap in the atlases (objects whose BakeUV texels are also claimed by another object bake garbage).
#   blender -b Office_bake.blend -P run.py -- uv_overlap.py [--atlas A,B]
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(argv[argv.index("--atlas") + 1].split(",")) if "--atlas" in argv else None
N = 1024
report = []
by_atlas = {}
for o in mesh_objects():
    if o.name == VIEW_OBJ or "BakeUV" not in o.data.uv_layers:
        continue
    me = o.data
    hid = np.zeros(len(me.polygons), bool); me.attributes["web_hidden"].data.foreach_get("value", hid)
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
    slots = [s.material for s in o.material_slots] or [None]
    names = np.array([atlas_of_material(o, slots[min(m, len(slots) - 1)]) or "" for m in mi], object)
    for a in set(names) - {"", "Vertex"}:
        if ONLY and a not in ONLY:
            continue
        by_atlas.setdefault(a, []).append((o, (names == a) & ~hid))
for a, members in sorted(by_atlas.items()):
    owner = np.full((N, N), -1, np.int32); clash = {}
    total = {}
    for k, (o, keep) in enumerate(members):
        me = o.data; me.calc_loop_triangles()
        t = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("loops", t); t = t.reshape(-1, 3)
        p = np.empty(len(me.loop_triangles), np.int32); me.loop_triangles.foreach_get("polygon_index", p)
        t = t[keep[p]]
        l = me.uv_layers["BakeUV"]; uv = np.empty(len(l.data) * 2, np.float32); l.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2) * (N - 1)
        mine = np.zeros((N, N), bool)
        for tri in t:
            q = uv[tri]; x0, y0 = np.floor(q.min(0)).astype(int); x1, y1 = np.ceil(q.max(0)).astype(int)
            if x1 - x0 > N or y1 - y0 > N:
                continue
            xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, N - 1) + 1), np.arange(max(y0, 0), min(y1, N - 1) + 1))
            P = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1); A, B, C = q
            def s(p1, p2): return (p2[0] - p1[0]) * (P[:, 1] - p1[1]) - (p2[1] - p1[1]) * (P[:, 0] - p1[0])
            d1, d2, d3 = s(A, B), s(B, C), s(C, A)
            ins = ((d1 > 0) & (d2 > 0) & (d3 > 0)) | ((d1 < 0) & (d2 < 0) & (d3 < 0))
            mine[ys.ravel()[ins], xs.ravel()[ins]] = True
        other = (owner >= 0) & (owner != k) & mine
        total[o.name] = int(mine.sum())
        if other.any():
            clash[o.name] = clash.get(o.name, 0) + int(other.sum())
            for j in np.unique(owner[other]):
                n2 = members[j][0].name; clash[n2] = clash.get(n2, 0) + int((other & (owner == j)).sum())
        owner[mine & (owner < 0)] = k
    bad = sorted(((n, c / max(total.get(n, 1), 1)) for n, c in clash.items() if c / max(total.get(n, 1), 1) > 0.02), key=lambda x: -x[1])
    report.append(f"OVERLAP {a}: {len(members)} objects, {len(bad)} overlapping >2%: " + ", ".join(f"{n} {f:.0%}" for n, f in bad[:12]))
for r in report:
    print(r)
