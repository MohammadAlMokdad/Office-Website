# Before/after renders of the simplified models (background):
#   blender -b Office_bake.blend -P web_lib.py -P check_lod.py -- Name1,Name2,...
# Each row: original | simplified | original | simplified. Writes build/renders/lod_sheet_<n>.png
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NAMES = argv[0].split(",") if argv else ["Ali_Headset", "Salah_Headset", "Laptop_Desk1", "Chair_Emp_Desk1"]
W, H = 400, 300
sc = bpy.context.scene
setup_cycles(48)
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.image_settings.file_format = "PNG"
cd = bpy.data.cameras.new("_lod"); cd.lens = 50; cd.clip_start = 0.005; cd.clip_end = 100
cam = bpy.data.objects.new("_lod", cd); sc.collection.objects.link(cam); sc.camera = cam


def frame(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    c = sum(pts, Vector()) / 8
    r = max((p - c).length for p in pts)
    d = Vector((CENTER.x - c.x, CENTER.y - c.y, 0))
    d = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
    d = (d + Vector((0, 0, 0.75))).normalized()
    dist = r / math.tan(math.atan(18 / cd.lens)) * 1.15
    cam.location = c + d * dist
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()


shots = []
for name in NAMES:
    lo = bpy.data.objects[name]; hp = bpy.data.objects[name + "_HP"]
    frame(lo)
    for label, show_hp in (("hp", True), ("lo", False)):
        if show_hp:
            sc.collection.objects.link(hp); lo.hide_render = True
        path = os.path.join(RENDER_DIR, f"lod_{name}_{label}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if show_hp:
            sc.collection.objects.unlink(hp); lo.hide_render = False
        shots.append(path)
        log(f"lod render {name} {label} ({tris(hp if show_hp else lo):,} tris)")

# contact sheet: 2 objects per row
cols = 4
rows = math.ceil(len(shots) / cols)
sheet = np.zeros((rows * H, cols * W, 4), np.float32)
for i, p in enumerate(shots):
    im = bpy.data.images.load(p); a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a)
    r, c = divmod(i, cols)
    sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = a.reshape(H, W, 4)
    bpy.data.images.remove(im)
out = bpy.data.images.new("lod_sheet", cols * W, rows * H, alpha=True)
out.pixels.foreach_set(sheet.ravel())
tag = argv[1] if len(argv) > 1 else "1"
out.filepath_raw = os.path.join(RENDER_DIR, f"lod_sheet_{tag}.png"); out.file_format = "PNG"; out.save()
log("lod sheet ->", out.filepath_raw)
