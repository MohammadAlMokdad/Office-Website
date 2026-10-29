# Median brightness (linear, interior pixels only) of each view: EEVEE vs Cycles, in stops.
import bpy, sys, os, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
R = os.path.join(os.environ.get("OFFICE_PROJECT") or os.path.join(os.path.expanduser("~"), "source", "repos", "office website 2"), "build", "renders")
def lum(path):
    im = bpy.data.images.load(path); w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    a = a.reshape(-1, 4)[:, :3]; lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    y = lin @ np.array([0.2126, 0.7152, 0.0722]); return y
for i in range(4):
    e = lum(os.path.join(R, f"view_{argv[0]}_EEVEE_{i}.png")); c = lum(os.path.join(R, f"view_{argv[1]}_CYCLES_{i}.png"))
    m = (e < 0.6) & (c < 0.6)               # leave out the windows
    for q in (25, 50, 75):
        pe, pc = np.percentile(e[m], q), np.percentile(c[m], q)
        print(f"view {i} p{q}: eevee {pe:.3f} cycles {pc:.3f}  diff {np.log2(pe / max(pc, 1e-6)):+.2f} stops")
