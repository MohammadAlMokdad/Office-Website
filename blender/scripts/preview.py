# Side-by-side previews: blender -b --factory-startup -P preview.py -- out.png size img1 [img2 ...]
#   .png textures are shown as stored (RGB), .exr as scene-linear through a plain sRGB curve x exposure 4
import bpy, sys, numpy as np
args = sys.argv[sys.argv.index("--") + 1:]
out, S, srcs = args[0], int(args[1]), args[2:]
tiles = []
for p in srcs:
    im = bpy.data.images.load(p, check_existing=False)
    if p.endswith(".png"): im.colorspace_settings.name = "Non-Color"
    w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, 4)
    step = max(1, w // S); a = a[::step, ::step][:S, :S].copy()
    if p.endswith(".exr"):
        x = np.clip(a[..., :3] * 4, 0, 1); a[..., :3] = np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
    a[..., 3] = 1; tiles.append(a)
row = np.concatenate(tiles, 1)
o = bpy.data.images.new("p", row.shape[1], row.shape[0]); o.colorspace_settings.name = "Non-Color"
o.pixels.foreach_set(row.ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
