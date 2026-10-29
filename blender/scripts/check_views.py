# Eye-level views of the room, EEVEE (the look the scene was built with) and/or Cycles (what gets baked):
#   blender -b Office_bake.blend -P run.py -- check_views.py <tag> [EEVEE,CYCLES] [samples]
# Writes build/renders/views_<tag>.png: one row per engine, one column per view.
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = argv[0] if argv else "a"
ENGINES = (argv[1] if len(argv) > 1 else "EEVEE,CYCLES").split(",")
SAMPLES = int(argv[2]) if len(argv) > 2 else 128
W, H = (int(v) for v in argv[4].split("x")) if len(argv) > 4 else (480, 300)
E = FLOOR_Z + EYE
# (eye x, y, look-at x, y, z)   Blender plan coordinates
VIEWS_ALL = [(-2.3, 1.6, 1.0, -2.0, E - 0.45),      # entrance, looking across the room
         (1.6, 1.4, -2.0, -2.6, E - 0.5),       # window desks, looking at the islands
         (-0.6, -0.4, -0.6, 2.2, E - 0.25),     # middle, looking at the TV wall
         (-0.2, 1.0, -0.8, -4.3, E - 0.55)]     # looking at the desk islands and the angled wall
VIEWS_CLOSE = [(-1.75, -3.0, -1.75, -3.6, 0.40),      # Ali's keyboard and mouse from ~70 cm
               (-0.62, -3.0, -0.62, -3.62, 0.42),     # Salah's keyboard
               (-0.35, -0.55, -1.18, -1.3, 0.25),     # the recliner
               (1.0, 1.45, 1.62, 1.45, 0.55)]         # window-desk laptop
if "--close" in sys.argv:
    VIEWS_ALL = VIEWS_CLOSE
NAMES = None
if "--set" in sys.argv:                          # named views shared with tools/check.mjs (tools/views.json)
    named = {k: v for k, v in json.load(open(os.path.join(PROJECT, "tools", "views.json"))).items() if k != "_"}
    want = sys.argv[sys.argv.index("--set") + 1]
    NAMES = [k for k in named if want == "issues" or k in want.split(",")]
    VIEWS_ALL = [named[k] for k in NAMES]
ONLY_VIEWS = [int(v) for v in argv[5].split(",")] if len(argv) > 5 and argv[5][0].isdigit() else None
VIEWS = [v for i, v in enumerate(VIEWS_ALL) if ONLY_VIEWS is None or i in ONLY_VIEWS]
PRESET = dict(kv.split("=") for kv in argv[3].split(",")) if len(argv) > 3 and argv[3] else {}
sc = bpy.context.scene
if PRESET:
    apply_light_preset({k: float(v) for k, v in PRESET.items()})
if "--noglass" in sys.argv:                      # experiment: what the window glass does to the view
    for o in mesh_objects():
        if any(s.material and s.material.name == "Glass_Clear" for s in o.material_slots):
            o.hide_render = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.image_settings.file_format = "PNG"
cd = bpy.data.cameras.new("_v"); cd.lens = 35 if "--close" in sys.argv else 18; cd.clip_start = 0.03; cd.clip_end = 1000; cd.sensor_width = 36
cam = bpy.data.objects.new("_v", cd); sc.collection.objects.link(cam); sc.camera = cam
paths = []
for eng in ENGINES:
    if eng == "CYCLES":
        setup_cycles(SAMPLES); sc.cycles.use_denoising = True
        if "--raw" in sys.argv:                  # no noise clamps: sharp, full-strength reflections (slower to converge)
            sc.cycles.sample_clamp_indirect = 0.0; sc.cycles.blur_glossy = 0.0
    else:
        sc.render.engine = "BLENDER_EEVEE"
    for i, v in enumerate(VIEWS):
        if len(v) == 7:                          # named view: eye x, y, z, target x, y, z, lens
            x, y, z, tx, ty, tz, cd.lens = v
        else:
            (x, y, tx, ty, tz), z = v, E
        cam.location = (x, y, z)
        cam.rotation_euler = (Vector((tx, ty, tz)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(RENDER_DIR, f"view_{TAG}_{eng}_{NAMES[i] if NAMES else i}.png"); sc.render.filepath = p
        t = time.time(); bpy.ops.render.render(write_still=True); paths.append(p)
        log(f"view {TAG} {eng} {i}: {time.time() - t:.1f}s")
rows, cols = len(ENGINES), len(VIEWS)
sheet = np.zeros((rows * H, cols * W, 4), np.float32)
for k, p in enumerate(paths):
    im = bpy.data.images.load(p); a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a)
    r, c = divmod(k, cols)
    sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = a.reshape(H, W, 4)
    bpy.data.images.remove(im)
out = bpy.data.images.new("views", cols * W, rows * H, alpha=True); out.pixels.foreach_set(sheet.ravel())
out.filepath_raw = os.path.join(RENDER_DIR, f"views_{TAG}.png"); out.file_format = "PNG"; out.save()
log("views ->", out.filepath_raw)
