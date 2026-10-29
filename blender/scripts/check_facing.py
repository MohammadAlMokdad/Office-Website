# Close-ups with backface culling (Workbench): a correctly oriented surface stays solid, an inside-out one vanishes.
#   blender -b <file.blend> -P run.py -- check_facing.py <tag> Name1,Name2,...
import sys
argv = sys.argv[sys.argv.index("--") + 1:]
TAG, NAMES = argv[0], argv[1].split(",")
W, H = 320, 240
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "OBJECT"; sh.show_backface_culling = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.image_settings.file_format = "PNG"
cd = bpy.data.cameras.new("_f"); cd.lens = 50; cd.clip_start = 0.005
cam = bpy.data.objects.new("_f", cd); sc.collection.objects.link(cam); sc.camera = cam
for o in bpy.data.objects:
    o.color = (0.8, 0.8, 0.8, 1)
tiles = []
for name in NAMES:
    o = bpy.data.objects[name]; o.color = (1.0, 0.45, 0.1, 1)
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]; c = sum(pts, Vector()) / 8; r = max((p - c).length for p in pts)
    d = (Vector((CENTER.x - c.x, CENTER.y - c.y, 0)).normalized() + Vector((0, 0, 0.9))).normalized()
    cam.location = c + d * r / math.tan(math.atan(18 / cd.lens)) * 1.2
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    p = os.path.join(RENDER_DIR, f"_facing_{TAG}_{name}.png"); sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    o.color = (0.8, 0.8, 0.8, 1)
    tiles.append(load_pixels(p, raw=True)); os.remove(p)
row = np.concatenate(tiles, 1)
write_png(os.path.join(RENDER_DIR, f"facing_{TAG}.png"), np.round(row * 255).astype(np.uint8))
