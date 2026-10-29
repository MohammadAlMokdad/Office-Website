# RGB and alpha of an RGBA texture side by side: blender -b --factory-startup -P alpha_preview.py -- out.png size img
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
out, S, src = a[0], int(a[1]), a[2]
im = bpy.data.images.load(src); im.colorspace_settings.name = "Non-Color"
w, h = im.size; p = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(p); p = p.reshape(h, w, 4)[::max(1, w // S), ::max(1, w // S)]
rgb = p.copy(); rgb[..., 3] = 1
al = np.repeat(p[..., 3:4], 4, axis=2); al[..., 3] = 1
row = np.concatenate([rgb, al], 1)
o = bpy.data.images.new("o", row.shape[1], row.shape[0]); o.colorspace_settings.name = "Non-Color"
o.pixels.foreach_set(row.ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
print("alpha stats: min", p[..., 3].min(), "max", p[..., 3].max(), "mean", p[..., 3].mean(), "rgb mean", p[..., :3].mean())
