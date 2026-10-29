# Step 6 (background, never saved over the bake file):
#   blender -b Office_bake.blend -P run.py -- s6_export.py
# -> build/office.glb      one mesh per atlas (static objects joined), one mesh per ceiling lamp (lamp_1..4), separate
#                          meshes for the parts the app moves, glass, the cables (vertex colours) and the outside view;
#                          only the BakeUV layer is kept
#    build/scene.json      what the app needs: atlases, glass looks, reflection panorama, exposure, eye height, seats,
#                          props, screens, the lamps and their wall switches, the windows' blinds
#    build/collision.json  floor-plan collision (room outline + furniture footprints) and the start position
#    build/textures/WindowView.png   the outside panorama as the camera sees it (view transform applied)
#    build/textures/blind_dark.png, blind_light.png (also in app/public/media/)   the blinds' cloth colour
import shutil
from mathutils import Matrix
from mathutils.geometry import convex_hull_2d
t0 = time.time()
sc = bpy.context.scene
atlases = json.loads(sc["web_atlases"])
env = json.load(open(os.path.join(BAKE_DIR, "env.json")))
view_strength = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"].inputs[2].default_value


# ---------------------------------------------------------------- face classes
def face_classes(o):
    """Per face: atlas name, "alpha_cutout" / "alpha_blend", "glass:<material>", "cables", or "" (deleted)."""
    me = o.data
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
    hid = np.zeros(len(me.polygons), bool)
    if "web_hidden" in me.attributes:
        me.attributes["web_hidden"].data.foreach_get("value", hid)
    slots = [s.material for s in o.material_slots] or [None]
    names = []
    for m in slots:
        a = atlas_of_material(o, m)
        if a == "Alpha":
            names.append("alpha_cutout" if m.name in CUTOUT_MATS else "alpha_blend")
        elif a == "Vertex":
            names.append("cables")
        elif a is None:
            names.append(f"glass:{m.name}" if m is not None and m.name in GLASS_MATS else "")
        else:
            names.append(a)
    out = np.array(names, object)[np.clip(mi, 0, len(names) - 1)]
    if o.name in SCREENS:                                # its screen faces: a separate mesh with screen UVs
        idx = [i for i, m in enumerate(slots) if m is not None and m.name == SCREENS[o.name]]
        out[np.isin(mi, idx) & (out != "")] = "screen"
    out[hid] = ""
    return out


def screen_uv(me, M):
    """ScreenUV for a screen mesh: u across the screen (arc length on a curved monitor), v up, both 0..1 over the faces
    that look the same way as the screen; faces looking elsewhere (edges, back) get (0, 0). Returns width / height and
    the part of the UV square you can see ([u0, v0, u1, v1]: the frame of a monitor can cover the panel's edges)."""
    R = M.to_3x3()
    nrm = [(R @ p.normal).normalized() for p in me.polygons]
    # the screen faces out where its faces look into open space (a box-shaped screen's back lies on the wall or the
    # housing, a two-layer panel's inner layer sits under the outer one)
    dg = bpy.context.evaluated_depsgraph_get()
    open_ = [i for i, p in enumerate(me.polygons)
             if not sc.ray_cast(dg, M @ p.center + nrm[i] * 1e-4, nrm[i], distance=0.1)[0]]
    pool = open_ or list(range(len(nrm)))
    n0 = sum((nrm[i] * me.polygons[i].area for i in pool), Vector()).normalized()
    n = sum((nrm[i] * me.polygons[i].area for i in pool if nrm[i].dot(n0) > 0.85), Vector()).normalized()  # not the edges
    up = Vector((0, 0, 1)); up = (up - n * up.dot(n)).normalized()
    right = (-n).cross(up).normalized()                  # the viewer's right, looking at the screen
    w = np.array([tuple(M @ v.co) for v in me.vertices])
    x, y, t = w @ np.array(right), w @ np.array(n), w @ np.array(up)
    front = [i for i, p in enumerate(me.polygons) if nrm[i].dot(n) > 0.5]
    fv = np.unique([v for i in front for v in me.polygons[i].vertices])
    s = x
    if np.ptp(y[fv]) > 0.002 * np.ptp(x[fv]):           # curved: circle through the screen in plan, arc length along it
        A = np.stack([x[fv], y[fv], np.ones(len(fv))], 1)
        a, b, c = np.linalg.lstsq(A, -(x[fv] ** 2 + y[fv] ** 2), rcond=None)[0]
        cx, cy = -a / 2, -b / 2; r = math.sqrt(max(cx * cx + cy * cy - c, 1e-12))
        side = -1.0 if cy > y[fv].mean() else 1.0         # centre in front of the screen (concave) or behind it
        s = r * np.arctan2(x - cx, side * (y - cy))
    s0, s1, t0, t1 = s[fv].min(), s[fv].max(), t[fv].min(), t[fv].max()
    uv = me.uv_layers.new(name="ScreenUV")
    ok = np.zeros(len(me.polygons), bool); ok[front] = True
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            uv.data[li].uv = ((s[vi] - s0) / (s1 - s0), (t[vi] - t0) / (t1 - t0)) if ok[p.index] else (0.0, 0.0)
    # visible: front faces with a clear line to where a viewer's eyes are (seated in front of a desk monitor, standing
    # in front of a wall screen); the frame, or the panel's outer layer, hides the rest
    c = sum((M @ me.polygons[i].center for i in front), Vector()) / len(front)
    seated = c.z < FLOOR_Z + 1.0
    eye = c + n * (0.8 if seated else 1.2); eye.z = FLOOR_Z + (1.2 if seated else EYE)
    seen = []
    for i in front:
        q = M @ me.polygons[i].center; d = eye - q
        if not sc.ray_cast(dg, q + d.normalized() * 2e-4, d.normalized(), distance=d.length)[0]:
            seen.append(i)
    sv = np.unique([v for i in (seen or front) for v in me.polygons[i].vertices])
    view = [(s[sv].min() - s0) / (s1 - s0), (t[sv].min() - t0) / (t1 - t0), (s[sv].max() - s0) / (s1 - s0), (t[sv].max() - t0) / (t1 - t0)]
    # the visible area as a flat frame (three.js): for HTML laid over a flat screen (the TV's YouTube player)
    wv = w[sv]; rr, uu, dd = wv @ np.array(right), wv @ np.array(up), wv @ np.array(n)
    mid = np.array(right) * (rr.min() + rr.max()) / 2 + np.array(up) * (uu.min() + uu.max()) / 2 + np.array(n) * dd.max()
    frame = {"center": blender_to_three(mid), "right": blender_to_three(right), "up": blender_to_three(up),
             "normal": blender_to_three(n), "size": [float(np.ptp(rr)), float(np.ptp(uu))]}
    frame = {k: [round(float(x), 4) for x in v] for k, v in frame.items()}
    return float((s1 - s0) / (t1 - t0)), [round(float(x), 4) for x in view], frame


def glass_look(m):
    bs = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bs is None:
        return None
    c = bs.inputs["Base Color"].default_value
    alpha = bs.inputs["Alpha"].default_value if not bs.inputs["Alpha"].is_linked else 1.0
    tr = bs.inputs["Transmission Weight"].default_value if not bs.inputs["Transmission Weight"].is_linked else 0.0
    if alpha < 0.02 and tr < 0.01:
        return None                                       # invisible in Blender too
    return {"color": [round(float(x), 4) for x in c[:3]], "alpha": round(float(alpha), 3), "transmission": round(float(tr), 3),
            "roughness": round(float(bs.inputs["Roughness"].default_value), 3), "ior": round(float(bs.inputs["IOR"].default_value), 3)}


# ---------------------------------------------------------------- cable colours (vertex bake -> display colours)
def cable_colours(o):
    f = os.path.join(BAKE_DIR, f"vertex_{o.name}.npz")
    if not os.path.exists(f):
        log(f"  WARNING no vertex bake for {o.name} yet: grey")
        lin = np.full((len(o.data.loops), 3), 0.05, np.float32)
    else:
        d = np.load(f)
        lin = d["light"] * d["albedo"] + d["emit"]
    n = len(lin); w = 1024; h = (n + w - 1) // w
    pad = np.zeros((h * w, 3), np.float32); pad[:n] = lin
    disp = view_transform(pad.reshape(h, w, 3)).reshape(-1, 3)[:n] / 255.0
    ca = o.data.color_attributes.get("web_color") or o.data.color_attributes.new("web_color", "BYTE_COLOR", "CORNER")
    rgba = np.ones((n, 4), np.float32); rgba[:, :3] = disp
    ca.data.foreach_set("color_srgb", rgba.ravel())


# ---------------------------------------------------------------- export materials
_MATS = {}


def export_material(cls, glass=None):
    """One plain material per class; the app swaps in its own shader by name (material extras carry the details)."""
    name = {"cables": "cables", "alpha_cutout": "alpha_cutout", "alpha_blend": "alpha_blend", "view": "window_view"}.get(cls)
    if name is None:
        name = f"glass_{cls[6:]}" if cls.startswith("glass:") else f"atlas_{cls}"
    if name in _MATS:
        return _MATS[name]
    clash = bpy.data.materials.get(name)
    if clash:
        clash.name = name + "_src"
    m = bpy.data.materials.new(name)
    m["web"] = json.dumps({"kind": "glass" if cls.startswith("glass:") else cls, **({"glass": glass} if glass else {})})
    if cls == "cables":                                  # so the exporter writes the colour attribute
        nt = m.node_tree; bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "web_color"
        nt.links.new(ca.outputs["Color"], bs.inputs["Base Color"])
    _MATS[name] = m
    return m


# ---------------------------------------------------------------- collision.json (floor plan, Blender x/y)
SKIP_PREFIX = ("Wall_", "Floor", "Ceiling", "Skirting", "Socket_", "Threshold", "Cables_", "Ports_", "Grommet_", "Strip_",
               "Brick_", "Wart_", "Charger_", "Dock_", "WindowView", "Window_", "Blind_", "Closet_", "CeilingLamp", "LightSwitch",
               "AliWall_", "Hatch_", "Door_")
obstacles = []
for o in mesh_objects():
    cols = {c.name for c in o.users_collection}
    if o.name.startswith(SKIP_PREFIX) or cols & {"Electrical", "Lighting", "Exterior", "Windows", "web_export"}:
        continue
    n = len(o.data.vertices)
    if not n:
        continue
    co = np.empty(n * 3); o.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    M = np.array(o.matrix_world); wv = co @ M[:3, :3].T + M[:3, 3]
    z = wv[:, 2] - FLOOR_Z
    if z.min() > 1.45:
        continue
    body = wv[(z > 0.04) & (z < 1.9)]
    if len(body) < 3:
        continue
    pts = body[:, :2]
    if len(pts) > 20000:
        pts = pts[np.random.default_rng(0).choice(len(pts), 20000, replace=False)]
    hull = [tuple(map(float, pts[i])) for i in convex_hull_2d([Vector(p) for p in pts])]
    area = 0.5 * abs(sum(hull[i][0] * hull[(i + 1) % len(hull)][1] - hull[(i + 1) % len(hull)][0] * hull[i][1] for i in range(len(hull))))
    if area < 0.004:
        continue
    obstacles.append({"name": o.name, "poly": [[round(x, 4), round(y, 4)] for x, y in hull]})


def seg_dist(p, a, b):
    (ax, ay), (bx, by), (px, py) = a, b, p
    dx, dy = bx - ax, by - ay; t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-12)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def clearance(p):
    d = min(seg_dist(p, ROOM[i], ROOM[(i + 1) % len(ROOM)]) for i in range(len(ROOM)))
    for ob in obstacles:
        poly = ob["poly"]
        if inside(p, poly):
            return 0.0
        d = min(d, min(seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))))
    return d


want = (-2.33, 1.53); best = None                       # by the entrance door
for r in [0.0] + [0.05 * k for k in range(1, 40)]:
    for ang in range(0, 360, 15):
        p = (want[0] + r * math.cos(math.radians(ang)), want[1] + r * math.sin(math.radians(ang)))
        if inside(p, ROOM) and clearance(p) >= 0.4:
            best = p; break
    if best:
        break
col = {"units": "metres, Blender plan coordinates (three.js: x = x, z = -y)", "floor": FLOOR_Z, "eye": EYE, "radius": 0.24,
       "room": [list(p) for p in ROOM], "obstacles": obstacles,
       "spawn": {"pos": [round(best[0], 3), round(best[1], 3)], "look": [1.0, -2.0]}}
json.dump(col, open(os.path.join(BUILD, "collision.json"), "w"))
log(f"collision.json: {len(obstacles)} obstacles, spawn {best}")

# ---------------------------------------------------------------- seats (three.js coordinates)
def world_box(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


seats = []
for chair, (target, reach, eye_h, label) in SEATS.items():
    if chair not in bpy.data.objects or target not in bpy.data.objects:
        log(f"seat skipped: {chair} / {target} missing"); continue
    clo, chi = world_box(bpy.data.objects[chair]); tlo, thi = world_box(bpy.data.objects[target])
    c, t = (clo + chi) / 2, (tlo + thi) / 2
    away = Vector((c.x - t.x, c.y - t.y, 0)); d = min(away.length, reach)
    eye = Vector((t.x, t.y, FLOOR_Z + eye_h)) + away.normalized() * d       # in line between the chair and its desk
    look = t.copy() if reach < 10 else Vector((t.x, t.y, eye.z))           # the screen / table; the TV straight ahead
    if target.startswith("Table"):
        look.z = eye.z - 0.3
    lo3, hi3 = blender_to_three(clo), blender_to_three(chi)
    seats.append({"name": chair, "label": label, "eye": [round(v, 3) for v in blender_to_three(eye)],
                  "look": [round(v, 3) for v in blender_to_three(look)],
                  "box": [[round(min(a, b), 3) for a, b in zip(lo3, hi3)], [round(max(a, b), 3) for a, b in zip(lo3, hi3)]]})
log("seats:", [s_["name"] for s_ in seats])
props = {}
for name, key in PROPS.items():
    if name in bpy.data.objects:
        lo, hi = world_box(bpy.data.objects[name]); lo3, hi3 = blender_to_three(lo), blender_to_three(hi)
        props[key] = {"center": [round(v, 3) for v in blender_to_three((lo + hi) / 2)],
                      "box": [[round(min(a, b), 3) for a, b in zip(lo3, hi3)], [round(max(a, b), 3) for a, b in zip(lo3, hi3)]]}


# ---------------------------------------------------------------- lamps, wall switches, blinds (three.js coordinates)
def r4(x):
    return round(float(x), 4) + 0.0                       # + 0.0: no "-0.0" in the JSON


def v3(v):
    return [r4(x) for x in blender_to_three(v)]


def box3(lo, hi):
    lo3, hi3 = blender_to_three(lo), blender_to_three(hi)
    return [[r4(min(a, b)) for a, b in zip(lo3, hi3)], [r4(max(a, b)) for a, b in zip(lo3, hi3)]]


def lamp_key(name):
    """lamp_n for ceiling lamp n's empty (CeilingLamp_n) or any of its parts (CeilingLamp_n_Head_a, _Plate)."""
    return next((k for k, pre in LAMPS.items() if name == pre.rstrip("_") or name.startswith(pre)), None)


def horizontal(v):
    return Vector((v.x, v.y, 0.0)).normalized()


def world_points(o, material=None):
    """The object's vertices in world space; with a material name, only the vertices of the faces that use it."""
    me = o.data
    idx = range(len(me.vertices))
    if material is not None:
        slots = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name == material}
        idx = sorted({v for p in me.polygons if p.material_index in slots for v in p.vertices})
    return [o.matrix_world @ me.vertices[i].co for i in idx]


def extent(pts, axis):
    q = [p.dot(axis) for p in pts]
    return min(q), max(q)


lamps, switches = {}, {}
for o in mesh_objects():
    key = lamp_key(o.name)
    if key and "_Head" in o.name:                         # where the lamp hangs: the middle of its heads
        lo, hi = world_box(o)
        lamps.setdefault(key, {"heads": []})["heads"].append((lo + hi) / 2)
for o in mesh_objects():
    if not (o.name.startswith("LightSwitch_") and "controls" in o):
        continue                                          # the rockers carry "controls"; the plates do not
    key = lamp_key(str(o["controls"]))
    if key is None:
        log(f"  WARNING {o.name} controls {o['controls']!r}, which is not a lamp in LAMPS"); continue
    lo, hi = world_box(o); c = (lo + hi) / 2
    d = CENTER - c; d.z = 0                               # out of the wall into the room, snapped to the nearest axis
    ax = 0 if abs(d.x) >= abs(d.y) else 1
    n = Vector((0, 0, 0)); n[ax] = 1.0 if d[ax] >= 0 else -1.0
    n3 = Vector(blender_to_three(n)); a3 = Vector((0, 1, 0)).cross(n3)   # the hinge: horizontal, along the wall
    switches[o.name] = {"controls": key, "center": v3(c), "box": box3(lo, hi),
                        "axis": [r4(x) for x in a3], "normal": [r4(x) for x in n3],
                        "onAngle": r4(o.get("on_angle_deg", 0.0)), "offAngle": r4(o.get("off_angle_deg", 0.0))}
    lamps.setdefault(key, {"heads": []})["switch"] = o.name
lamps = {k: {"center": v3(sum(v["heads"], Vector()) / len(v["heads"])), "switch": v.get("switch")}
         for k, v in lamps.items() if v["heads"]}
log("lamps:", {k: v["switch"] for k, v in lamps.items()}, "switches:", {k: v["controls"] for k, v in switches.items()})

blinds = {}
for w, (dark, light, frame) in BLINDS.items():
    names = (dark, light, frame, f"Window_{w}_Sash_L", f"Window_{w}_Sash_R")
    objs = [bpy.data.objects.get(n) for n in names]
    if None in objs:
        log(f"blind {w} skipped: missing {[n for n, o in zip(names, objs) if o is None]}"); continue
    o_dark, o_light, o_frame, sash_l, sash_r = objs
    flo, fhi = world_box(o_frame)
    # along the window: the frame's long axis (modelled along its local x and turned with the wall), pointing from the
    # left sash to the right one, which is your left looking out. Not the line between the sashes' centres: they slide
    # on two tracks, so that line is a couple of degrees off the wall.
    R = o_frame.matrix_world.to_3x3()
    ext = [max(c[i] for c in o_frame.bound_box) - min(c[i] for c in o_frame.bound_box) for i in range(3)]
    axes = [R @ Vector(e) for e in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    i = max(range(3), key=lambda i: ext[i] * Vector((axes[i].x, axes[i].y, 0)).length)
    along = horizontal(axes[i])
    if along.length < 0.5:                               # no horizontal long axis: the world box decides
        along = Vector((1, 0, 0)) if fhi.x - flo.x >= fhi.y - flo.y else Vector((0, 1, 0))
    cl, cr = sum(world_box(sash_l), Vector()) / 2, sum(world_box(sash_r), Vector()) / 2
    if along.dot(cr - cl) < 0:
        along = -along
    out = (flo + fhi) / 2 - CENTER
    outward = horizontal(out - along * out.dot(along))    # from the room through the window, square to the frame

    def sheet(o, material):
        """The sheet hangs from the middle of the roller's underside, as wide as the cloth on the roll."""
        pts = world_points(o, material) or world_points(o)
        a0, a1 = extent(pts, along); b0, b1 = extent(pts, outward)
        lo, hi = world_box(o)
        top = along * ((a0 + a1) / 2) + outward * ((b0 + b1) / 2) + Vector((0, 0, lo.z))
        return {"top": v3(top), "width": r4(a1 - a0), "roll": box3(lo, hi)}

    pts = world_points(sash_l) + world_points(sash_r)      # the glass: both sashes as one flat frame
    a0, a1 = extent(pts, along); b0, b1 = extent(pts, outward); z0, z1 = extent(pts, Vector((0, 0, 1)))
    centre = along * ((a0 + a1) / 2) + outward * ((b0 + b1) / 2) + Vector((0, 0, (z0 + z1) / 2))
    blinds[w] = {"along": v3(along), "outward": v3(outward), "bottom": r4(flo.z),
                 "dark": sheet(o_dark, "Blind_Dark"), "light": sheet(o_light, "Blind_Light"),
                 "glass": {"center": v3(centre), "size": [r4(a1 - a0), r4(z1 - z0)]}}
log("blinds:", {w: {"dark": b["dark"]["width"], "light": b["light"]["width"], "glass": b["glass"]["size"]} for w, b in blinds.items()})


# ---------------------------------------------------------------- build
for o in list(bpy.data.objects):                         # flat hierarchy, world transforms kept
    if o.parent:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type in ("LIGHT", "LIGHT_PROBE", "CAMERA", "EMPTY"):
        bpy.data.objects.remove(o, do_unlink=True)
hp = bpy.data.collections.get(HIGHPOLY)
if hp:
    for o in list(hp.objects):
        bpy.data.objects.remove(o, do_unlink=True)

EXPORT = bpy.data.collections.new("web_export"); sc.collection.children.link(EXPORT)
glass_info, parts = {}, {}                               # parts: class -> [objects to join]
screens = {}                                             # screen mesh -> width / height
separate = []
for o in mesh_objects():
    if not len(o.data.polygons):
        continue
    if o.name == VIEW_OBJ:
        p = bpy.data.objects.new("window_view", o.data.copy()); p.matrix_world = o.matrix_world.copy()
        p.data.materials.clear(); p.data.materials.append(export_material("view"))
        for ca in list(p.data.color_attributes):
            p.data.color_attributes.remove(ca)
        EXPORT.objects.link(p); continue
    if o.name.startswith(VERTEX_PREFIX):
        cable_colours(o)
    cls = face_classes(o)
    keep_whole = o.name.startswith(KEEP_SEPARATE)
    for c in sorted(set(cls) - {""}):
        glass = None
        if c.startswith("glass:"):
            glass = glass_look(bpy.data.materials[c[6:]])
            if glass is None:
                continue
            glass_info[c[6:]] = glass
        me = o.data.copy()
        bm = bmesh.new(); bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        kill = [f for f in bm.faces if cls[f.index] != c]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(me); bm.free()
        for l in [l for l in me.uv_layers if l.name != "BakeUV" or c.startswith("glass:") or c == "cables"]:
            me.uv_layers.remove(l)
        for ca in [ca for ca in me.color_attributes if not (c == "cables" and ca.name == "web_color")]:
            me.color_attributes.remove(ca)
        for at in [at.name for at in me.attributes if at.name.startswith("web_") and at.name != "web_color"]:
            me.attributes.remove(me.attributes[at])
        base_cls = atlas_of_material(o, bpy.data.materials[SCREENS[o.name]]) if c == "screen" else c
        me.materials.clear(); me.materials.append(export_material(base_cls, glass))
        me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), np.int32))
        p = bpy.data.objects.new(f"{o.name}__{c}", me)
        p.matrix_world = o.matrix_world.copy()
        EXPORT.objects.link(p)
        if c == "screen":
            aspect, view, frame = screen_uv(me, o.matrix_world)
            screens[f"screen_{o.name}"] = {"aspect": round(aspect, 4), "view": view, "frame": frame}
            p["web_rename"] = f"screen_{o.name}"; p["web_class"] = base_cls
            separate.append(p)
        elif keep_whole and not c.startswith("glass:"):
            p["web_rename"] = o.name
            for k in o.keys():
                if not k.startswith("web_") and not k.startswith("_"):
                    try:
                        p[k] = o[k]
                    except Exception:
                        pass
            p["web_class"] = c
            separate.append(p)
        else:
            name = c.replace(":", "_")                   # one mesh per class ...
            lamp = lamp_key(o.name) if not (c.startswith("glass:") or c in ("cables", "alpha_cutout", "alpha_blend")) else None
            if lamp and parts.get(lamp, (c,))[0] == c:   # ... but a ceiling lamp's parts: one mesh per lamp, in its atlas
                name = lamp
            parts.setdefault(name, (c, []))[1].append(p)

for o in mesh_objects():                                 # originals are done with
    if o.users_collection and o.users_collection[0].name != "web_export":
        bpy.data.objects.remove(o, do_unlink=True)
for p in separate:
    p.name = p["web_rename"]; del p["web_rename"]
joined = []
for name, (c, objs) in sorted(parts.items()):
    base = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    EXPORT.objects.link(base)
    objs = [base] + objs
    with override(objs, base):
        bpy.ops.object.join()
    base.data.materials.clear()
    base.data.materials.append(export_material(c, glass_info.get(c[6:]) if c.startswith("glass:") else None))
    base.data.polygons.foreach_set("material_index", np.zeros(len(base.data.polygons), np.int32))
    base["web_class"] = c
    joined.append((base.name, len(base.data.polygons)))
for o in EXPORT.objects:
    if o.data.validate(verbose=False, clean_customdata=False):
        log(f"  {o.name}: mesh validation fixed invalid data")
log("export meshes:", joined, "+ separate:", [p.name for p in separate])

# ---------------------------------------------------------------- outside view as the camera sees it
pano_img = next(n.image for n in bpy.data.materials["WindowView_Emission"].node_tree.nodes if n.type == "TEX_IMAGE")
w, h = pano_img.size; ch = pano_img.channels
a = np.empty(w * h * ch, np.float32); pano_img.pixels.foreach_get(a); a = a.reshape(h, w, ch)[..., :3]
lin = srgb_decode(a) if not pano_img.is_float else a
tw, th = 4096, int(round(4096 * h / w / 4)) * 4
tmp = bpy.data.images.new("web_pano", w, h, float_buffer=True)
px = np.ones((h, w, 4), np.float32); px[..., :3] = lin * view_strength; tmp.pixels.foreach_set(px.ravel())
tmp.scale(tw, th)
b = np.empty(tw * th * 4, np.float32); tmp.pixels.foreach_get(b); bpy.data.images.remove(tmp)
view_png = view_transform(b.reshape(th, tw, 4)[..., :3])
write_png(os.path.join(TEX_DIR, "WindowView.png"), view_png)
# colours for what lies beyond the photo (looking steeply up or down through a window): its sky and its ground
sky_rgb = (view_png[int(th * 0.9):].reshape(-1, 3).mean(0) / 255).round(4).tolist()      # rows bottom-up: top 10 %
ground_rgb = (view_png[:int(th * 0.1)].reshape(-1, 3).mean(0) / 255).round(4).tolist()
log(f"outside view {w}x{h} -> {tw}x{th}, camera strength {view_strength}")

# ---------------------------------------------------------------- the blinds' cloth (the app unrolls a sheet of it)
for img_name, out_name in (("Tex_BlindDark_Albedo", "blind_dark"), ("Tex_BlindLight_Albedo", "blind_light")):
    im = bpy.data.images.get(img_name)
    if im is None:
        log(f"  WARNING no image {img_name}: {out_name}.png not written"); continue
    w, h = im.size; ch = im.channels
    a = np.empty(w * h * ch, np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, ch)[..., :3]
    if im.is_float:                                      # float pixels are scene-linear; bytes are sRGB as they are
        a = srgb_encode(a)
    s = min(w, h); y0 = (h - s) // 2; x0 = (w - s) // 2  # square (the images have a spare row top and bottom)
    rgb = np.round(np.clip(a[y0:y0 + s, x0:x0 + s], 0, 1) * 255).astype(np.uint8)
    path = os.path.join(TEX_DIR, f"{out_name}.png"); write_png(path, rgb)
    shutil.copyfile(path, os.path.join(PROJECT, "app", "public", "media", f"{out_name}.png"))
    log(f"  {out_name}.png: {img_name} {w}x{h} -> {s}x{s} sRGB")

# ---------------------------------------------------------------- glTF
for o in bpy.context.selected_objects:
    o.select_set(False)
for o in EXPORT.objects:
    o.select_set(True)
glb = os.path.join(BUILD, "office.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_extras=True, export_apply=False,
                          export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
                          export_image_format="NONE", export_vertex_color="NAME", export_vertex_color_name="web_color",
                          export_all_vertex_colors=False, export_active_vertex_color_when_no_material=False,
                          export_animations=False, export_cameras=False, export_lights=False, export_yup=True)
ntri = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in EXPORT.objects)
log(f"exported {glb}: {os.path.getsize(glb) / 1e6:.1f} MB, {len(EXPORT.objects)} meshes, {ntri:,} triangles")

# ---------------------------------------------------------------- scene.json
xs = [p[0] for p in ROOM]; ys = [p[1] for p in ROOM]
scene_json = {
    "units": "metres, three.js axes (x, y up, z = -Blender y)",
    "atlases": {a: {"size": v["size"], "pxPerM": v["px_per_m"]} for a, v in atlases.items()},
    "glass": glass_info,
    "env": {"probes": {k: {"file": f"env_{k}.exr", "center": blender_to_three(v["center_blender"])} for k, v in env["probes"].items()},
            "atlasProbe": env["atlas_probe"], "meanLuminance": env["mean_luminance"],
            "boxMin": [min(xs), FLOOR_Z, -max(ys)], "boxMax": [max(xs), CEIL_Z, -min(ys)]},
    "exposure": sc.view_settings.exposure, "view": sc.view_settings.view_transform,
    "backdrop": {"sky": sky_rgb, "ground": ground_rgb},             # display sRGB, behind the outside view
    "props": props,                  # things the app needs the place of (three.js): centre and box
    "seats": seats,                  # E on the chair: seated eye, where you look, the chair's box (three.js)
    "screens": screens,              # meshes with ScreenUV (TEXCOORD_1): width / height, visible part of the UV square
    "lamps": lamps,                  # lamp_n meshes: where each hangs, the wall switch rocker that controls it
    "switches": switches,            # the rockers: lamp, centre, box, hinge axis, out of the wall, on / off tilt (deg)
    "blinds": blinds,                # per window: along / outward, the sheets' top and width, the rolls, the glass
    "floor": FLOOR_Z, "ceiling": CEIL_Z, "eye": EYE,
}
json.dump(scene_json, open(os.path.join(BUILD, "scene.json"), "w"), indent=1)


log(f"step6 done in {time.time() - t0:.0f}s")
