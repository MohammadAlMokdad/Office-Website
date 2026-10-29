# Step 5b (background): 360-degree HDR panoramas of the room for live reflections in the app.
#   blender -b Office_bake.blend -P run.py -- s5_env.py [--samples 512] [--probes center,TVWall]
# One probe in the middle of the room (floor, walls, ceiling, glass) and one per furniture area, at head height, so
# glossy things reflect the room as seen from where they stand (box projection fixes the walls, not the furniture).
# Laid out like three.js equirect maps (image centre = +X, right = -Y Blender, top = up).
# Writes build/bake/env_<probe>.exr and env.json: probe positions, which atlas uses which probe, the room box.
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 512
ONLY = set(argv[argv.index("--probes") + 1].split(",")) if "--probes" in argv else None
AREA_PROBES = ("TVWall", "IslandAli", "IslandSalah", "WindowDesks", "Lounge")
HEAD = FLOOR_Z + 1.6           # standing eye height
TOWARD_ROOM = 0.7              # metres from an area's middle towards the room's middle: where people stand
t0 = time.time()
sc = bpy.context.scene
setup_cycles(SAMPLES)
sc.cycles.use_denoising = True

# probe positions: the middle of the room, and the middle of each furniture area's footprint
probes = {"center": (Vector(CENTER), 2048)}
for area in AREA_PROBES:
    objs = [o for o in mesh_objects() if o.name != VIEW_OBJ and group_of(o) == area]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    xs = sorted(p.x for p in pts); ys = sorted(p.y for p in pts)
    mid = Vector(((xs[0] + xs[-1]) / 2, (ys[0] + ys[-1]) / 2, 0)); to = Vector((CENTER.x, CENTER.y, 0)) - mid
    mid += to.normalized() * min(TOWARD_ROOM, to.length) if to.length > 1e-6 else Vector()
    probes[area] = (Vector((mid.x, mid.y, HEAD)), 1024)

# Reflections must see what Cycles' glossy rays see: the outside view at the strength that lights the room (the camera
# only sees it at a lower strength), and the sun and lamps themselves (lights are invisible to camera rays by default).
n = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"]
window_light = n.inputs[1].default_value + n.inputs[2].default_value
n.inputs[1].default_value = 0.0; n.inputs[2].default_value = window_light
# ... and reflected windows show sky only (a reflection of the city photo on the floor looks wrong): the outside view
# becomes the average colour of the photo's sky, mostly desaturated: the photo's deep blue at window strength tinted
# every reflection blue, while daylight through a window reads as a soft, nearly white glow
wnt = bpy.data.materials["WindowView_Emission"].node_tree
tex = next(x for x in wnt.nodes if x.type == "TEX_IMAGE"); em = next(x for x in wnt.nodes if x.type == "EMISSION")
pano = tex.image; pw, ph = pano.size; ch = pano.channels
px = np.empty(pw * ph * ch, np.float32); pano.pixels.foreach_get(px); px = px.reshape(ph, pw, ch)[..., :3]
top = px[int(ph * 0.88):]                                  # rows are bottom-up: the top 12 % of the photo
SKY = srgb_decode(top.reshape(-1, 3)).mean(0) if not pano.is_float else top.reshape(-1, 3).mean(0)
SKY_SATURATION = 0.2
SKY = float(SKY @ np.array([0.2126, 0.7152, 0.0722])) * (1 - SKY_SATURATION) + SKY * SKY_SATURATION
for l in list(wnt.links):
    if l.to_node == em and l.to_socket.name == "Color":
        wnt.links.remove(l)
em.inputs["Color"].default_value = (*SKY, 1.0)
log(f"env: windows reflect sky colour {tuple(round(float(c), 3) for c in SKY)} at strength {window_light:.3f}")
for o in bpy.data.objects:
    if o.type == "LIGHT" and not o.hide_render:
        o.visible_camera = True
cd = bpy.data.cameras.new("web_env"); cd.type = "PANO"
try:
    cd.panorama_type = "EQUIRECTANGULAR"
except Exception:
    cd.cycles.panorama_type = "EQUIRECTANGULAR"
cd.clip_start = 0.02; cd.clip_end = 1000
cam = bpy.data.objects.new("web_env", cd); sc.collection.objects.link(cam)
cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
sc.camera = cam
sc.render.resolution_percentage = 100
sc.render.use_compositing = False
s = sc.render.image_settings; s.file_format = "OPEN_EXR"; s.color_depth = "16"; s.color_mode = "RGB"

meta_path = os.path.join(BAKE_DIR, "env.json")
old = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
out = old.get("probes", {})
for name, (pos, width) in probes.items():
    if ONLY and name not in ONLY:
        continue
    t = time.time()
    cam.location = pos
    sc.render.resolution_x, sc.render.resolution_y = width, width // 2
    path = os.path.join(BAKE_DIR, f"env_{name}.exr"); sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path); W, H = img.size
    a = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(a); bpy.data.images.remove(img)
    lum = a.reshape(H, W, 4)[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
    lat = (np.arange(H) + 0.5) / H * math.pi - math.pi / 2
    wgt = np.cos(lat)[:, None] * np.ones((1, W))
    out[name] = {"file": f"env_{name}.exr", "center_blender": list(pos), "mean_luminance": float((lum * wgt).sum() / wgt.sum()), "size": [W, H]}
    log(f"env probe {name} at ({pos.x:.2f}, {pos.y:.2f}, {pos.z:.2f}), {W}x{H}, mean {out[name]['mean_luminance']:.3f}, {time.time() - t:.0f}s")

xs = [p[0] for p in ROOM]; ys = [p[1] for p in ROOM]
meta = {"probes": out,
        "atlas_probe": {**{a: "center" for a in ATLAS}, **{a: a for a in AREA_PROBES}},
        "mean_luminance": out["center"]["mean_luminance"],
        "box_blender": {"min": [min(xs), min(ys), FLOOR_Z], "max": [max(xs), max(ys), CEIL_Z]},
        "window_light": window_light, "exposure": sc.view_settings.exposure}
json.dump(meta, open(meta_path, "w"), indent=1)
log(f"env probes done, {time.time() - t0:.0f}s")
