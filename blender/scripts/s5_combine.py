# Step 5c (background): raw bakes -> final textures in build/textures/
#   blender -b Office_bake.blend -P run.py -- s5_combine.py [--atlas A,B]
#   <a>.png       RGB = (light x albedo + emission) through the scene's view transform (AgX, exposure): what Blender shows
#                 A   = specular occlusion (ambient occlusion within 0.6 m), Alpha atlas: opacity
#   <a>_spec.png  RGB = specular colour at normal incidence (sRGB-encoded), A = roughness       (half size)
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(filter(None, (argv[argv.index("--atlas") + 1] if "--atlas" in argv else "").split(",")))
sc = bpy.context.scene
env = json.load(open(os.path.join(BAKE_DIR, "env.json")))
L_REF = env["mean_luminance"]
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(path):
    return load_pixels(path)


def combine(a):
    t0 = time.time()
    P = lambda k: os.path.join(BAKE_DIR, f"{a}_{k}.exr")
    light = load(P("light"))[..., :3]
    alb = load(P("albedo"))[..., :3]
    emit = load(P("emit"))[..., :3]
    col = light * alb + emit
    if a == "Alpha":
        alpha = np.clip(load(P("alpha"))[..., 0], 0, 1)
        col = np.where(alpha[..., None] > 0.02, col / np.maximum(alpha[..., None], 0.02), col)
        A = alpha
    else:                                        # specular occlusion from the ambient-occlusion bake
        A = np.clip(load(P("ao"))[..., 0], 0, 1)
    rgba = np.empty(col.shape[:2] + (4,), np.uint8)
    rgba[..., :3] = view_transform(col)
    rgba[..., 3] = np.round(A * 255).astype(np.uint8)
    write_png(os.path.join(TEX_DIR, f"{a}.png"), rgba)
    f0 = load(P("f0"))[..., :3]; rough = load(P("rough"))[..., 0]
    spec = np.empty(f0.shape[:2] + (4,), np.uint8)
    spec[..., :3] = np.round(srgb_encode(f0) * 255).astype(np.uint8)
    spec[..., 3] = np.round(np.clip(rough, 0, 1) * 255).astype(np.uint8)
    write_png(os.path.join(TEX_DIR, f"{a}_spec.png"), spec)
    log(f"combined {a}: {col.shape[1]}px colour, {spec.shape[1]}px reflection map, occlusion mean {A.mean():.2f}, {time.time() - t0:.0f}s")


for a in sorted(ATLAS):
    if ONLY and a not in ONLY:
        continue
    if not os.path.exists(os.path.join(BAKE_DIR, f"{a}_light.exr")):
        log(f"combine: {a} not baked yet"); continue
    combine(a)
