# Step 2 (live session, run with: python bl.py s2_cleanup.py 1800 --lib)
#  a) shared meshes -> single user (shared data = shared UVs = objects baking on top of each other)
#  b) heavy imported models simplified; the untouched originals go to the excluded "_HighPoly" collection
#  c) faces the visitor can never see get the face attribute "web_hidden" (no texture space; deleted at export)

# triangle targets for the heavy models; anything else above GENERIC_MIN is reduced by GENERIC_RATIO
TARGET = {"Ali_Headset": 15000, "Salah_Headset": 15000, "Laptop_Desk1": 45000, "Laptop_Desk2": 45000,
          "Chair_Emp_Desk1": 20000, "Chair_Emp_Desk2": 20000, "Chair_Emp_IslandWest": 20000, "Chair_Emp_RoundTable": 20000,
          "Recliner": 25000, "Ali_Mouse_BasiliskV3": 8000, "Salah_Mouse_BasiliskV3": 8000, "Ali_PC": 20000,
          "Ali_Monitor": 100000,   # full original: decimating it left slivers that baked as speckles "Salah_MacBook_Laptop": 15000, "Ali_Keyboard_K380": 25000, "SalahUnit_XboxController": 10000,
          "MhmdDesk_WaterBottle": 8000, "Salah_Keyboard": 12000, "Recliner_RemoteTV": 6000}
GENERIC_MIN, GENERIC_RATIO, GENERIC_FLOOR = 8000, 0.45, 5000
NO_DECIMATE = ("Cables_",)                    # thin tubes kink when collapsed
SMOOTH_ANGLE = math.radians(35)

live_guard()
t0 = time.time()
if bpy.context.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
before = sum(tris(o) for o in mesh_objects())

# a) single user
n_single = 0
for o in mesh_objects(include_hidden=True):
    if o.data.users > 1:
        o.data = o.data.copy(); n_single += 1
log(f"step2: {n_single} objects given their own mesh")

# b) simplify
hp = bpy.data.collections.get(HIGHPOLY) or bpy.data.collections.new(HIGHPOLY)
if hp.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(hp)
lc = bpy.context.view_layer.layer_collection.children[hp.name]
lc.exclude = True

plan = {}
for o in mesh_objects():
    n = tris(o)
    if o.name in TARGET and n > TARGET[o.name] * 1.1:
        plan[o.name] = TARGET[o.name]
    elif o.name not in TARGET and n > GENERIC_MIN and not o.name.startswith(NO_DECIMATE) and o.name != VIEW_OBJ:
        plan[o.name] = max(GENERIC_FLOOR, int(n * GENERIC_RATIO))

dg = bpy.context.evaluated_depsgraph_get()
done = []
for name, target in plan.items():
    o = bpy.data.objects[name]
    if bpy.data.objects.get(name + "_HP"):
        continue                                      # already simplified in an earlier run
    src = o.copy(); src.data = o.data.copy(); src.name = name + "_HP"; src.parent = None
    src.matrix_world = o.matrix_world.copy()
    hp.objects.link(src)
    n0 = tris(o)
    mod = o.modifiers.new("web_decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"; mod.ratio = target / n0; mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data; o.modifiers.remove(mod); o.data = me; me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    done.append((name, n0, tris(o)))
for name, a, b in sorted(done, key=lambda x: -x[1]):
    log(f"  simplified {name}: {a:,} -> {b:,} tris")
# collapsed meshes: imported custom normals no longer fit, so smooth shading with sharp edges by angle
for o in mesh_objects():
    if not bpy.data.objects.get(o.name + "_HP") or o.get("web_shaded"):
        continue
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        if o.data.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=SMOOTH_ANGLE)
    o["web_shaded"] = True

# c) faces nobody can see: front side faces away from every possible eye position
#    (the eye stays inside the room prism, which is convex, so testing its corners is enough)
inset = 0.15
cx = sum(p[0] for p in ROOM) / len(ROOM); cy = sum(p[1] for p in ROOM) / len(ROOM)
corners = []
for x, y in ROOM:
    d = Vector((cx - x, cy - y)); d.normalize()
    for h in (1.05, EYE + 0.15):
        corners.append((x + d.x * inset * 1.42, y + d.y * inset * 1.42, FLOOR_Z + h))
C = np.array(corners).T                               # 3 x K

def closed_outward(bm):
    if not all(e.is_manifold and e.is_contiguous for e in bm.edges):
        return False
    return bm.calc_volume(signed=True) > 0

stats = {}
for o in mesh_objects():
    if o.name == VIEW_OBJ:
        continue
    me = o.data
    attr = me.attributes.get("web_hidden") or me.attributes.new("web_hidden", "BOOLEAN", "FACE")
    hidden = np.zeros(len(me.polygons), bool)
    structure = bool({c.name for c in o.users_collection} & {"Structure"})
    bm = bmesh.new(); bm.from_mesh(me)
    ok = structure or closed_outward(bm)
    bm.free()
    if ok and len(me.polygons):
        M = o.matrix_world; R = np.array(M.to_3x3().inverted().transposed())
        cen = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("center", cen); cen = cen.reshape(-1, 3)
        nor = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("normal", nor); nor = nor.reshape(-1, 3)
        Mw = np.array(M)
        cw = cen @ Mw[:3, :3].T + Mw[:3, 3]
        nw = nor @ R.T; nw /= np.maximum(np.linalg.norm(nw, axis=1, keepdims=True), 1e-12)
        best = (nw @ C).max(axis=1)                   # max over eye corners of dot(eye, n)
        hidden = best < (nw * cw).sum(1) + 1e-5
        mats = [s.material for s in o.material_slots]
        mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
        for i, m in enumerate(mats):
            if m and m.name in GLASS_MATS:
                hidden[mi == i] = False
    attr.data.foreach_set("value", hidden)
    area = np.empty(len(me.polygons)); me.polygons.foreach_get("area", area)
    s = abs(o.matrix_world.to_3x3().determinant()) ** (2 / 3)
    g = group_of(o); st = stats.setdefault(g, [0.0, 0.0, 0, 0])
    st[0] += float(area.sum()) * s; st[1] += float(area[hidden].sum()) * s; st[2] += 1; st[3] += int(ok)
for g, (a, h, n, k) in sorted(stats.items()):
    log(f"  {g}: {a:.1f} m2, hidden {h:.1f} m2 ({100 * h / max(a, 1e-9):.0f}%), tested {k}/{n} objects")

after = sum(tris(o) for o in mesh_objects())
log(f"step2 done in {time.time() - t0:.0f}s: {before:,} -> {after:,} triangles, {len(mesh_objects())} meshes")
