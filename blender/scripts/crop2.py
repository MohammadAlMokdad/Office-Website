import bpy, sys, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
out, x0, y0, w, h = a[0], *map(int, a[1:5]); srcs = a[5:]
tiles = []
for p in srcs:
    im = bpy.data.images.load(p); im.colorspace_settings.name = "Non-Color"
    W, H = im.size; px = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(H, W, 4)[::-1]
    tiles.append(px[y0:y0 + h, x0:x0 + w])
row = np.concatenate(tiles, 1); row[..., 3] = 1
o = bpy.data.images.new("o", row.shape[1], row.shape[0]); o.colorspace_settings.name = "Non-Color"
o.pixels.foreach_set(row[::-1].ravel()); o.filepath_raw = out; o.file_format = "PNG"; o.save()
