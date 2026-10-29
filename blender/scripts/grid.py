# Image grid: blender -b --factory-startup -P grid.py -- out.png cols tile_width img1 img2 ...
# Images fill rows left to right, top to bottom; each is scaled to tile_width (keeping its aspect).
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
out, cols, TW, srcs = a[0], int(a[1]), int(a[2]), a[3:]
tiles = []
for p in srcs:
    im = bpy.data.images.load(p, check_existing=False); im.colorspace_settings.name = "Non-Color"
    w, h = im.size; th = round(h * TW / w); im.scale(TW, th)
    x = np.empty(TW * th * 4, np.float32); im.pixels.foreach_get(x); x = x.reshape(th, TW, 4); x[..., 3] = 1
    tiles.append(x[::-1])                                  # top-down
TH = max(t.shape[0] for t in tiles)
rows = (len(tiles) + cols - 1) // cols
g = np.zeros((rows * TH, cols * TW, 4), np.float32); g[..., 3] = 1
for i, t in enumerate(tiles):
    r, c = divmod(i, cols); g[r * TH:r * TH + t.shape[0], c * TW:(c + 1) * TW] = t
o = bpy.data.images.new("g", g.shape[1], g.shape[0]); o.colorspace_settings.name = "Non-Color"
o.pixels.foreach_set(g[::-1].ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
