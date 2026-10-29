# Step 4 (live, or background): a "BakeUV" layer on every mesh, each atlas packed into its own 0-1 square.
#   python bl.py s4_uv.py 3600 --lib            (all atlases)   set ONLY below to redo some
# Faces go to the atlas of their material (atlas_of_material); hidden and glass faces get no texture space.
# Materials keep reading their own UVs: BakeUV is the *active* layer (bake target), never the active *render* layer.
import sys
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(globals().get("ONLY_ATLASES", [])) | set(filter(None, (_argv[_argv.index("--atlas") + 1] if "--atlas" in _argv else "").split(",")))
# small things with text get more texels than their size would give them (x linear density)
DENSITY_BOOST = {"SalahItem_BeHappySticker": 4.0, "MhmdDesk_MouseLogo": 3.0, "ZouheirDesk_MouseLogo": 3.0,
                 "MhmdIQOS_TereaTurquoise": 2.0}
MARGIN_PX = 2                      # gap between islands, in texels of the atlas
# long bent tubes (cables) unwrap into thin curved strips that cannot be packed: cut them into short straight pieces
ANGLE = 66                         # smart project angle limit

if bpy.data.filepath and "Office_bake" in bpy.data.filepath and not bpy.app.background:
    live_guard()
if bpy.context.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
t0 = time.time()


def face_atlases(o):
    """Per face: atlas name or None."""
    me = o.data
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
    hid = np.zeros(len(me.polygons), bool)
    if "web_hidden" in me.attributes:
        me.attributes["web_hidden"].data.foreach_get("value", hid)
    slots = [s.material for s in o.material_slots] or [None]
    names = np.array([atlas_of_material(o, slots[i] if i < len(slots) else None) or "" for i in range(max(len(slots), 1))], object)
    out = names[np.clip(mi, 0, len(names) - 1)]
    out[hid] = ""
    return out


def ensure_bake_uv(o):
    me = o.data
    if "BakeUV" in me.uv_layers:
        return me.uv_layers["BakeUV"]
    if len(me.uv_layers) == 0:                   # keep "no UVs" behaviour for the materials: all-zero render layer
        me.uv_layers.new(name="UVMap")
    render = next((l for l in me.uv_layers if l.active_render), me.uv_layers[0])
    uv = me.uv_layers.new(name="BakeUV")
    render.active_render = True
    return uv


def uv_array(o):
    l = o.data.uv_layers["BakeUV"]; a = np.empty(len(l.data) * 2, np.float32); l.data.foreach_get("uv", a)
    return a.reshape(-1, 2)


def loops_of(me, mask):
    ls = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", lt)
    idx = [np.arange(s, s + t) for s, t, m in zip(ls, lt, mask) if m]
    return np.concatenate(idx) if idx else np.zeros(0, np.int64)


def select_faces(o, mask):
    me = o.data
    me.polygons.foreach_set("select", mask)
    me.edges.foreach_set("select", np.zeros(len(me.edges), bool))
    me.vertices.foreach_set("select", np.zeros(len(me.vertices), bool))
    me.update()


def world_area(o, mask):
    a = np.empty(len(o.data.polygons)); o.data.polygons.foreach_get("area", a)
    return float(a[mask].sum()) * abs(o.matrix_world.to_3x3().determinant()) ** (2 / 3)


def uv_area(o, mask):
    me = o.data; me.calc_loop_triangles()
    t = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("loops", t); t = t.reshape(-1, 3)
    p = np.empty(len(me.loop_triangles), np.int32); me.loop_triangles.foreach_get("polygon_index", p)
    t = t[mask[p]]
    a = uv_array(o); p0, p1, p2 = a[t[:, 0]], a[t[:, 1]], a[t[:, 2]]
    return float(0.5 * np.abs((p1[:, 0] - p0[:, 0]) * (p2[:, 1] - p0[:, 1]) - (p2[:, 0] - p0[:, 0]) * (p1[:, 1] - p0[:, 1])).sum())


def edit(objs, fn):
    select_only(objs)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["BakeUV"]
    with override(objs, objs[0]):
        bpy.ops.object.mode_set(mode="EDIT")
        try:
            fn()
        finally:
            bpy.ops.object.mode_set(mode="OBJECT")


def unwrap_atlas(name, members, angle=None, margin_px=None):
    """UVs of one atlas. Faces outside the atlas are hidden during the UV operators (this scene has UV sync
    selection on, where "select all" would grab every face of the mesh) and their UVs restored afterwards."""
    angle = ANGLE if angle is None else angle
    margin_px = MARGIN_PX if margin_px is None else margin_px
    size = ATLAS[name]
    objs = [o for o, _ in members]
    masks = {o.name: m for o, m in members}
    saved = {o.name: uv_array(o).copy() for o in objs}
    inside = {o.name: loops_of(o.data, masks[o.name]) for o in objs}
    # 1) every object unwrapped on its own (multi-object smart project can collapse whole objects)
    for o in objs:
        select_faces(o, masks[o.name])
        def proj():
            bpy.ops.mesh.hide(unselected=True)
            bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                                     correct_aspect=True, scale_to_bounds=False)
            bpy.ops.mesh.reveal(select=False)
        edit([o], proj)

    # 2) same texel density everywhere, then one pack for the whole atlas
    def average():
        bpy.ops.mesh.hide(unselected=True)
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.mesh.reveal(select=False)

    def pack(shape):
        def fn():
            bpy.ops.mesh.hide(unselected=True)
            bpy.ops.uv.select_all(action="SELECT")
            bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                                    margin_method="FRACTION", margin=margin_px / size, shape_method=shape)
            bpy.ops.mesh.reveal(select=False)
        return fn
    for shape in ("CONCAVE", "AABB"):
        for o in objs:
            select_faces(o, masks[o.name])
        edit(objs, average)
        for o in objs:                               # boosted objects: bigger islands before the pack keeps their share
            k = DENSITY_BOOST.get(o.name)
            if k:
                a = uv_array(o); li = inside[o.name]; c = a[li].mean(0)
                a[li] = (a[li] - c) * k + c
                o.data.uv_layers["BakeUV"].data.foreach_set("uv", a.ravel())
        for o in objs:
            select_faces(o, masks[o.name])
        edit(objs, pack(shape))
        bad = [o.name for o in objs if np.any((uv_array(o)[inside[o.name]] < -1e-4) | (uv_array(o)[inside[o.name]] > 1 + 1e-4))]
        flat = [o.name for o in objs if uv_area(o, masks[o.name]) < 1e-10]
        if not bad and not flat:
            break
        log(f"  {name}: {shape} packing left {len(bad)} objects outside 0-1, {len(flat)} without area: {(bad + flat)[:6]}")
    else:
        raise RuntimeError(f"atlas {name} could not be packed")
    # 3) faces of other atlases keep their UVs
    for o in objs:
        a = uv_array(o); out = np.ones(len(a), bool); out[inside[o.name]] = False
        a[out] = saved[o.name][out]
        o.data.uv_layers["BakeUV"].data.foreach_set("uv", a.ravel())
    wa = sum(world_area(o, masks[o.name]) for o in objs)
    ua = sum(uv_area(o, masks[o.name]) for o in objs)
    density = size * math.sqrt(ua / max(wa, 1e-9))
    log(f"atlas {name}: {len(objs)} objects, {wa:.1f} m2 visible, {ua:.0%} of the square used, {size}px "
        f"-> {density:.0f} px/m ({1000 / density:.1f} mm per texel)  [angle {angle}, margin {margin_px}px]")
    return {"size": size, "objects": len(objs), "area_m2": round(wa, 2), "uv_used": round(ua, 3), "px_per_m": round(density)}


# assign faces to atlases
members = {}
for o in mesh_objects():
    if o.name == VIEW_OBJ or not len(o.data.polygons):
        continue
    fa = face_atlases(o)
    ensure_bake_uv(o)
    for name in set(fa) - {"", "Vertex"}:
        members.setdefault(name, []).append((o, fa == name))
    # faces without texture space: collapse to a corner (bake writes nothing there; export deletes / re-materials them)
    none = (fa == "") | (fa == "Vertex")
    if none.any():
        a = uv_array(o); a[loops_of(o.data, none)] = 0.0
        o.data.uv_layers["BakeUV"].data.foreach_set("uv", a.ravel())

info = json.loads(bpy.context.scene.get("web_atlases", "{}"))
for name in sorted(members):
    if ONLY and name not in ONLY:
        continue
    info[name] = unwrap_atlas(name, members[name])
bpy.context.scene["web_atlases"] = json.dumps(info)
for o in mesh_objects():                         # leave every mesh with everything selected, like before
    o.data.polygons.foreach_set("select", np.ones(len(o.data.polygons), bool)); o.data.update()
log(f"step4 done in {time.time() - t0:.0f}s")
bpy.ops.wm.save_mainfile()
