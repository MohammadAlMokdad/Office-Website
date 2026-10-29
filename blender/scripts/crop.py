# Crops of a texture at full resolution: blender -b --factory-startup -P crop.py -- out.png size x0,y0 x1,y1 ... img
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
out, S, src = a[0], int(a[1]), a[-1]
im = bpy.data.images.load(src, check_existing=False)
if src.endswith(".png"): im.colorspace_settings.name = "Non-Color"
w, h = im.size; p = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(p); p = p.reshape(h, w, 4)
if src.endswith(".exr"):
    x = np.clip(p[..., :3] * 4, 0, 1); p[..., :3] = np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
tiles = []
for xy in a[2:-1]:
    x0, y0 = (int(float(v) * (w if i == 0 else h)) for i, v in enumerate(xy.split(",")))
    t = p[y0:y0 + S, x0:x0 + S].copy(); t[..., 3] = 1; tiles.append(t)
row = np.concatenate(tiles, 1)
o = bpy.data.images.new("c", row.shape[1], row.shape[0]); o.colorspace_settings.name = "Non-Color"
o.pixels.foreach_set(row.ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
