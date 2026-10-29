# Stack two view sheets vertically: blender -b --factory-startup -P stack.py -- top.png bottom.png out.png
import bpy, sys, numpy as np
a, b, out = sys.argv[sys.argv.index("--") + 1:]
ims = [bpy.data.images.load(p) for p in (a, b)]
arr = []
for im in ims:
    w, h = im.size; x = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(x); arr.append(x.reshape(h, w, 4))
s = np.concatenate([arr[1], arr[0]], 0)          # Blender rows go bottom-up
o = bpy.data.images.new("s", s.shape[1], s.shape[0], alpha=True); o.pixels.foreach_set(s.ravel())
o.filepath_raw = out; o.file_format = "PNG"; o.save()
