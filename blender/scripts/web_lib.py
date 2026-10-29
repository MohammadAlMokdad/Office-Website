# Shared settings and helpers for the web bake pipeline (live session via bl.py --lib, or background via run.ps1).
import bpy, bmesh, math, os, json, time
import numpy as np
from mathutils import Vector

# Project root: OFFICE_PROJECT env var, else ~/source/repos/office website 2.
PROJECT = os.environ.get("OFFICE_PROJECT") or os.path.join(os.path.expanduser("~"), "source", "repos", "office website 2")
BUILD = os.path.join(PROJECT, "build")
BAKE_DIR = os.path.join(BUILD, "bake")          # raw float bakes (EXR)
TEX_DIR = os.path.join(BUILD, "textures")       # final atlases (PNG)
RENDER_DIR = os.path.join(BUILD, "renders")     # test renders
for _d in (BUILD, BAKE_DIR, TEX_DIR, RENDER_DIR):
    os.makedirs(_d, exist_ok=True)

FLOOR_Z = -0.367                                # floor top (Blender z)
CEIL_Z = 2.468                                  # ceiling underside
EYE = 1.62                                      # standing eye height above the floor
# walkable outline: the inner wall faces, Blender plan coordinates
ROOM = [(-2.876, 2.220), (2.084, 2.220), (2.084, -1.335), (0.515, -4.395), (-2.876, -4.395)]
CENTER = Vector((-0.40, -1.09, FLOOR_Z + 1.55))  # middle of the room, for the reflection panorama

HIGHPOLY = "_HighPoly"                          # excluded collection: untouched originals of simplified objects
VIEW_OBJ = "WindowView_Cylinder"                # the outside panorama: shown as is, never baked
# see-through surfaces: not baked; the app draws them as reflective glass
GLASS_MATS = {"Alcohol_Liquid", "Glass", "Glass.001", "Glass_Clear", "MhmdDesk_PET", "MhmdDesk_Water", "SpectacleLens",
              "Spray_Bottle_Plastic", "Spray_Cap", "Tracker_Glass_MAT", "MhmdDesk_WatchCrystal"}
# partly transparent surfaces: baked into the RGBA "Alpha" atlas (colour + opacity)
ALPHA_MATS = {"Mesh", "M2_stoel_gaas", "Click_Decal_MAT", "Decal_MAT", "Logo_MAT", "Logo_RTX"}
CUTOUT_MATS = {"Click_Decal_MAT", "Decal_MAT", "Logo_MAT", "Logo_RTX"}    # alpha-tested in the app (decals)
# reflection look per material in the app (the Blender materials stay as they are): matte where the source is shinier
# than the real thing. rough = roughness, coat = clear-coat weight used for the reflection.
SPEC_OVERRIDE = {
    "Floor_Tile_Cream": {"rough": 0.45, "coat": 0.0},       # matte tiles: a soft sheen, no mirror
    "Door_Wood_Brown": {"rough": 0.65, "coat": 0.0},        # matte wood
    "material.005": {"rough": 0.55},                        # Xbox controller (its gloss map was wired in as roughness)
}
KEEP_SEPARATE = ("WallClock_HourHand", "WallClock_MinuteHand", "LightSwitch_", "Door_White_Leaf", "Door_Wood_Leaf")
# screens the app shows content on: object -> its screen material. Exported as separate "screen_<object>" meshes with
# a second UV layer (ScreenUV) spanning the screen 0..1 (horizontally along the curve of curved monitors).
SCREENS = {"Ali_Monitor": "Screen_Off_Black", "AliWall_DisplayOutlets": "Wall_Display_Screen", "TV_75in": "TV_Screen",
           "Salah_MonitorFlat": "Screen_Off_Black", "Salah_MonitorCurved": "Screen_Off_Black",
           "Laptop_Desk1": "Layar", "Laptop_Desk2": "Layar"}         # Zuhair's and Mhmd's laptops (VS Code in the app)
# small things the app needs the place of (the remotes you click): object -> key in scene.json "props"
PROPS = {"Recliner_RemoteTV": "tvRemote", "Recliner_RemoteSoundbar": "soundbarRemote", "Soundbar": "soundbar",
         "SalahUnit_RemoteRed": "blindRemoteRed", "SalahUnit_RemoteBlue": "blindRemoteBlue", "SalahUnit_Movmax": "movmax"}
# the ceiling lamps the wall switches control (LightSwitch_*_* meshes carry "controls"): the lamp's objects (heads, plate)
# are exported as one mesh each, so the app can dim a lamp's glow on its own. Order = light group order in the app.
LAMPS = {"lamp_1": "CeilingLamp_1_", "lamp_2": "CeilingLamp_2_", "lamp_3": "CeilingLamp_3_", "lamp_4": "CeilingLamp_4_"}
# the windows and their roller blinds (rolled up in the model; the app unrolls a sheet from each roller): window ->
# (dark blind, light blind, frame). Order = light group order in the app (win_South, win_East, win_Angled).
BLINDS = {"South": ("Blind_South_Dark", "Blind_South_Light", "Window_South_Frame"),
          "East": ("Blind_East_Dark", "Blind_East_Light", "Window_East_Frame"),
          "Angled": ("Blind_Angled_Dark", "Blind_Angled_Light", "Window_Angled_Frame")}
# light groups the app can switch (baked one by one by s5_groups.py): the four lamps, the sky's daylight per window,
# then the direct sun (it comes in through the South window; a closed blind takes it away whole)
LIGHT_GROUPS = list(LAMPS) + [f"win_{w}" for w in BLINDS] + ["sun"]
REST_GROUP = "other"                            # every other emitter (screens, LEDs): baked too, so the groups add up to all the light
# places you can sit (look at the chair, E): chair -> (what you face, at most this far from your eyes, seated eye height
# above the floor, label)
SEATS = {
    "Chair_Emp_IslandWest": ("Ali_Monitor", 0.75, 1.17, "sit at Ali's desk"),
    "Chair_Salah": ("Salah_MonitorCurved", 0.75, 1.17, "sit at Salah's desk"),
    "Chair_Emp_Desk1": ("Laptop_Desk1", 0.55, 1.17, "sit at Zuhair's desk"),
    "Chair_Emp_Desk2": ("Laptop_Desk2", 0.55, 1.17, "sit at Mhmd's desk"),
    "Chair_Emp_RoundTable": ("Table_Round", 0.75, 1.17, "sit at the round table"),
    "Recliner": ("TV_75in", 99.0, 1.05, "sit in the recliner"),
}

# atlas size per bake group
ATLAS = {"Floor": 4096, "Ceiling": 2048, "Structure": 4096, "IslandAli": 4096, "IslandSalah": 4096, "WindowDesks": 4096,
         "TVWall": 4096, "Lounge": 4096, "Electrical": 1024, "Lighting": 1024, "Alpha": 2048}


BAKE_FILE = os.path.join(PROJECT, "blender", "Office_bake.blend")


def live_guard():
    """Live-session scripts edit only the bake file: stop if another file is open."""
    if os.path.normcase(os.path.abspath(bpy.data.filepath)) != os.path.normcase(BAKE_FILE):
        raise RuntimeError(f"open file is {bpy.data.filepath!r}, expected {BAKE_FILE!r}: nothing was changed")


def log(*a):
    s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(s)
    with open(os.path.join(BUILD, "log.txt"), "a", encoding="utf8") as f:
        f.write(s + "\n")


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def wcenter(o):
    q = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(q, Vector()) / 8


def mesh_objects(include_hidden=False):
    hp = bpy.data.collections.get(HIGHPOLY)
    hp_objs = set(hp.all_objects) if hp else set()
    return [o for o in bpy.data.objects if o.type == "MESH" and o not in hp_objs and (include_hidden or not o.hide_render)]


def group_of(o):
    """Bake group (atlas) of an object, by collection and position in the room."""
    cols = {c.name for c in o.users_collection}
    if "Electrical" in cols:
        return "Electrical"
    if "Lighting" in cols:
        return "Lighting"
    if cols & {"Structure", "Doors", "Windows"}:
        n = o.name.lower()
        return "Floor" if n.startswith("floor") else "Ceiling" if n.startswith("ceiling") else "Structure"
    c = wcenter(o) + Vector((1.185, 0.418, 0))   # the area split below was drawn before the room moved
    if c.y < -1.6 and c.x < 1.6:
        return "IslandAli" if c.x < 0 else "IslandSalah"
    if c.x > 2.4 and c.y > -0.6:
        return "WindowDesks"
    if c.y > 1.9:
        return "TVWall"
    return "Lounge"


# long thin tubes: lighting baked into vertex colours (a texture atlas cannot pack their unwrapped strips)
VERTEX_PREFIX = ("Cables_",)


def atlas_of_material(o, mat):
    """Which atlas a face with this material is baked into (None = not baked, "Vertex" = vertex colours)."""
    if o.name == VIEW_OBJ or (mat is not None and mat.name in GLASS_MATS):
        return None
    if o.name.startswith(VERTEX_PREFIX):
        return "Vertex"
    if mat is None:
        return group_of(o)
    if mat.name in ALPHA_MATS:
        return "Alpha"
    return group_of(o)


def override(objs, active):
    return bpy.context.temp_override(active_object=active, object=active, selected_objects=objs,
                                     selected_editable_objects=objs)


def select_only(objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def setup_cycles(samples, scene=None):
    scene = scene or bpy.context.scene
    scene.render.engine = "CYCLES"
    cp = bpy.context.preferences.addons["cycles"].preferences
    for dev in ("OPTIX", "CUDA"):
        try:
            cp.compute_device_type = dev
            cp.get_devices()
            gpus = [d for d in cp.devices if d.type == dev]
            if gpus:
                for d in cp.devices:
                    d.use = d.type == dev
                scene.cycles.device = "GPU"
                break
        except Exception as e:
            log("device", dev, "failed", e)
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.sample_clamp_indirect = 10.0      # no fireflies from the sun patch bouncing
    scene.cycles.blur_glossy = 1.0


def eye_points():
    """Every place the visitor's eye can be: a grid over the room at standing (and sitting) heights."""
    xs = [p[0] for p in ROOM]; ys = [p[1] for p in ROOM]
    pts = []
    for x in np.arange(min(xs) + 0.15, max(xs) - 0.1, 0.2):
        for y in np.arange(min(ys) + 0.15, max(ys) - 0.1, 0.2):
            if inside((x, y), ROOM):
                for h in (1.05, 1.45, EYE, EYE + 0.15):
                    pts.append((x, y, FLOOR_Z + h))
    return np.array(pts, np.float64)


def inside(p, poly):
    c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1:
            c = not c
    return c


# ---------------------------------------------------------------- simplification (step 2)
def hidden_eye_corners(inset=0.15):
    cx = sum(p[0] for p in ROOM) / len(ROOM); cy = sum(p[1] for p in ROOM) / len(ROOM)
    out = []
    for x, y in ROOM:
        d = Vector((cx - x, cy - y)); d.normalize()
        for h in (1.05, EYE + 0.15):
            out.append((x + d.x * inset * 1.42, y + d.y * inset * 1.42, FLOOR_Z + h))
    return np.array(out).T


def mark_hidden(o, C=None):
    """Face attribute web_hidden: the face's front side points away from every place the eye can be.
    Only trusted on closed meshes with outward normals (and the room shell)."""
    C = hidden_eye_corners() if C is None else C
    me = o.data
    attr = me.attributes.get("web_hidden") or me.attributes.new("web_hidden", "BOOLEAN", "FACE")
    hidden = np.zeros(len(me.polygons), bool)
    structure = bool({c.name for c in o.users_collection} & {"Structure"})
    bm = bmesh.new(); bm.from_mesh(me)
    ok = structure or (all(e.is_manifold and e.is_contiguous for e in bm.edges) and bm.calc_volume(signed=True) > 0)
    bm.free()
    if ok and len(me.polygons):
        Mw = np.array(o.matrix_world); R = np.array(o.matrix_world.to_3x3().inverted().transposed())
        cen = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("center", cen); cen = cen.reshape(-1, 3)
        nor = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("normal", nor); nor = nor.reshape(-1, 3)
        cw = cen @ Mw[:3, :3].T + Mw[:3, 3]
        nw = nor @ R.T; nw /= np.maximum(np.linalg.norm(nw, axis=1, keepdims=True), 1e-12)
        hidden = (nw @ C).max(axis=1) < (nw * cw).sum(1) + 1e-5
        mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
        for i, s in enumerate(o.material_slots):
            if s.material and s.material.name in GLASS_MATS:
                hidden[mi == i] = False
    attr.data.foreach_set("value", hidden)
    return ok, hidden


def simplify(o, target, normals="ANGLE"):
    """Rebuild o from its _HP original, collapsed to ~target triangles.
    normals: ANGLE = smooth + sharp edges by angle, or a Data Transfer loop mapping (custom normals from the original)."""
    src = bpy.data.objects[o.name + "_HP"]
    for m in [m for m in o.modifiers if m.name.startswith("web_")]:
        o.modifiers.remove(m)
    old = o.data; o.data = src.data.copy(); bpy.data.meshes.remove(old)
    n0 = tris(o)
    mod = o.modifiers.new("web_decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"; mod.ratio = min(1.0, target / n0); mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.remove(mod)
    old = o.data; o.data = me; me.name = src.data.name.split(".")[0] + "_web"; bpy.data.meshes.remove(old)
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        if o.data.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth(); o.data.set_sharp_from_angle(angle=math.radians(35))
    if normals != "ANGLE":
        m = o.modifiers.new("web_normals", "DATA_TRANSFER")
        m.object = src; m.use_object_transform = True
        m.use_loop_data = True; m.data_types_loops = {"CUSTOM_NORMAL"}; m.loop_mapping = normals
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        o.modifiers.remove(m)
        old = o.data; o.data = me; me.name = old.name; bpy.data.meshes.remove(old)
    o["web_target"] = target; o["web_normals"] = normals
    for k in ("web_shaded",):
        if k in o: del o[k]
    mark_hidden(o)
    return n0, tris(o)


def with_highpoly(fn):
    """Run fn() with the _HighPoly collection evaluated (hidden), so modifiers can read the originals."""
    hp = bpy.data.collections[HIGHPOLY]
    lc = bpy.context.view_layer.layer_collection.children[hp.name]
    lc.exclude = False; hp.hide_render = True
    for o in hp.objects:
        o.hide_set(True)
    bpy.context.view_layer.update()
    try:
        return fn()
    finally:
        lc.exclude = True


# ---------------------------------------------------------------- lighting (step 3)
def apply_light_preset(p):
    """Multipliers on the scene's light sources (relative to how the scene was built):
    day = window panorama light, spot = ceiling spots, sun, sky = world, glow = lamp-head emission; exp = exposure (stops, absolute)."""
    sc = bpy.context.scene
    base = json.loads(sc.get("web_light_base", "{}"))
    if not base:                                    # remember the original values once
        n = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"]
        base = {"day": n.inputs[1].default_value, "sun": bpy.data.objects["Sun_Daylight"].data.energy,
                "sky": sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value,
                "spots": {o.name: o.data.energy for o in bpy.data.objects if o.type == "LIGHT" and o.name.startswith("CeilingLamp_")},
                "glow": {m.name: next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Emission Strength"].default_value
                         for m in bpy.data.materials if m.name.startswith("CeilingLamp_") and "Glow" in m.name},
                "exp": sc.view_settings.exposure}
        sc["web_light_base"] = json.dumps(base)
    n = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"]
    n.inputs[1].default_value = base["day"] * p.get("day", 1.0)
    bpy.data.objects["Sun_Daylight"].data.energy = base["sun"] * p.get("sun", 1.0)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = base["sky"] * p.get("sky", 1.0)
    for name, e in base["spots"].items():
        bpy.data.objects[name].data.energy = e * p.get("spot", 1.0)
    for name, e in base["glow"].items():
        next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Emission Strength"].default_value = e * p.get("glow", 1.0)
    sc.view_settings.exposure = p.get("exp", base["exp"])
    log("light preset", p)


# ---------------------------------------------------------------- images (steps 5-6)
import zlib as _zlib, struct as _struct


def load_pixels(path, raw=False):
    """Image file -> float array (h, w, 4), rows bottom-up. raw=True: no colour conversion (PNG bytes / 255)."""
    im = bpy.data.images.load(path, check_existing=False)
    if raw:
        im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def write_png(path, rgba8):
    """uint8 (h, w, 3|4), rows bottom-up -> PNG as is (no colour management, no alpha premultiplication)."""
    h, w, c = rgba8.shape
    raw = b"".join(b"\x00" + np.ascontiguousarray(rgba8[h - 1 - y]).tobytes() for y in range(h))
    def chunk(t, d):
        return _struct.pack(">I", len(d)) + t + d + _struct.pack(">I", _zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", _struct.pack(">IIBBBBB", w, h, 8, 6 if c == 4 else 2, 0, 0, 0))
                + chunk(b"IDAT", _zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def view_transform(rgb, scene=None):
    """Scene-linear RGB (h, w, 3) -> display uint8 exactly as Blender shows it (view transform, look, exposure, dither)."""
    sc = scene or bpy.context.scene
    h, w, _ = rgb.shape
    im = bpy.data.images.new("web_vt", w, h, alpha=False, float_buffer=True)
    px = np.ones((h, w, 4), np.float32); px[..., :3] = rgb; im.pixels.foreach_set(px.ravel())
    tmp = os.path.join(BAKE_DIR, f"_vt_{os.getpid()}.png")
    s = sc.render.image_settings; s.file_format = "PNG"; s.color_mode = "RGB"; s.color_depth = "8"
    im.save_render(tmp, scene=sc)
    bpy.data.images.remove(im)
    a = load_pixels(tmp, raw=True); os.remove(tmp)
    return np.round(a[..., :3] * 255).astype(np.uint8)


def srgb_encode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_decode(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def blender_to_three(v):
    return [v[0], v[2], -v[1]]


def flip_faces(o, idx):
    """Flip exactly these faces (custom normals follow). Only the listed faces are selected, in face mode: with
    vertices left selected, edit mode would flush the selection to every face and flip the whole object."""
    idx = set(int(i) for i in idx)
    if not idx:
        return
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    select_only([o])
    with override([o], o):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bm = bmesh.from_edit_mesh(o.data)
        for v in bm.verts:
            v.select = False
        for e in bm.edges:
            e.select = False
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.select = f.index in idx
        bm.select_flush_mode()
        bmesh.update_edit_mesh(o.data)
        bpy.ops.mesh.flip_normals()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
