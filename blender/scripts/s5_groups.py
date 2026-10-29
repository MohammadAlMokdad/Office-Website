# Step 5d (background): one bake per switchable light group -> fraction maps, so the app can switch the ceiling lamps
# off and close the blinds on top of the full bake (s5_bake.py), whose look stays exactly as it is.
#   blender -b Office_bake.blend -P run.py -- s5_groups.py [--div 4] [--samples 64] [--atlas A,B] [--groups g1,g2] [--force]
#                                                          [--fast] [--check]
# Groups (web_lib.LIGHT_GROUPS): lamp_1..lamp_4 = a lamp's four spots and its two glow materials; win_South, win_East,
# win_Angled = the sky's daylight (the outside panorama and the sky, no sun) through that window only (black planes
# just outside the other two windows keep their daylight out); sun = the direct sun (and its bounces) through whichever
# window it comes in, so a closed blind can take the sun patch away whole; other (web_lib.REST_GROUP) = every other
# emitting surface (LEDs, screens, the AC display): the part of the light no switch takes away. The fractions are of
# the groups' own sum, so they add up to exactly 1 and the room goes exactly dark with everything off (no residue of
# the sampling noise between the group bakes and the full bake).
# Each group is baked at the atlas's full size with --samples paths per texel and box-filtered down by --div (so a map
# texel mixes exactly the texels the full bake's does, and gets div^2 x --samples paths: at a reduced size the bake
# itself would rasterise the tightly packed islands differently), then denoised. 48-64 spp: the maps agree with the
# full bake within about 10 % per texel inside the islands (less in near-black texels, which hardly matters).
# Per atlas, at the atlas size / div (at least 256 px), into build/bake/:
#   <a>_g_normal.exr    object-space normal (the full bake's, box-filtered: the denoiser's guide)
#   <a>_g_<group>.exr   diffuse light (direct + bounce, no surface colour) from that group alone, OIDN-denoised
# and into build/textures/ (linear data, no gamma; tools/compress.mjs --groups makes the .ktx2 files):
#   <a>_lamps.png       R G B A = the fraction of the texel's baked COLOUR that came from lamp_1 .. lamp_4 (a lamp's own
#                       glow counts for its lamp: <a>_g_<lamp>_emit.exr, an EMIT bake with only that glow on)
#   <a>_day.png         R G B = the fraction from the sky's daylight through the South, East, Angled windows, A = the sun
#                       Both stored as sqrt(fraction) (the shader squares them): 8 bits hold a lamp's 1-3 % share of a wall
#                       as 25-45 steps instead of 3-8. A texel's own emission (screens, LEDs) is in no channel: it stays.
# build/bake/groups.json: each group's colour relative to all light (tint, per channel) and its share of all the light
# (probe), over every baked texel of every atlas done so far (the per-atlas sums they are made of are kept in it).
# --fast: fewer bounces (3 diffuse / 6 / 2 glossy; the full bake's 6 / 12 / 4 otherwise: late bounces are a real part of
# the light). --check: also bakes everything on (<a>_g_check_all.exr) and logs how it compares with the full bake.
# Resumable: a group's exr is skipped when it exists (--force bakes it again). The bake file is never saved.
# Prints GROUPS_DONE at the very end, GROUPS_FAILED and the traceback on any error.
import sys, traceback
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
DIV = max(1, int(arg("--div", "4")))
SAMPLES = int(arg("--samples", "64"))
ONLY = [a for a in (arg("--atlas", "") or "").split(",") if a]
ALL = list(LIGHT_GROUPS) + [REST_GROUP]          # the switchable groups, then the rest: together, all the light
GROUPS = [g for g in (arg("--groups", "") or "").split(",") if g] or ALL
FORCE = "--force" in argv
FAST = "--fast" in argv
CHECK = "--check" in argv
MIN_SIZE = 256                  # px: the smallest fraction map
BLOCKER_OUT = 0.065             # m: the black plane sits this far outside the middle of the window frame
BLOCKER_MARGIN = 0.1            # m: and reaches this far beyond the frame's extents each way
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
try:
    sys.stdout.reconfigure(line_buffering=True)   # the log is watched while it grows
except Exception:
    pass


def say(*a):
    log(*a); sys.stdout.flush()


sc = bpy.context.scene
setup_cycles(SAMPLES)
sc.cycles.use_denoising = False                  # OIDN runs in the compositor, with the normal map as guide
sc.cycles.use_adaptive_sampling = False          # a few paths per texel, every texel alike: the box filter averages them
sc.render.bake.margin_type = "ADJACENT_FACES"
if FAST:
    sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 3; sc.cycles.glossy_bounces = 2
sc.render.use_persistent_data = True             # the scene stays on the GPU between bakes: a group's changes are small
# the clock hands turn in the app: no shadows of the modelled time (as in s5_bake.py)
for _o in bpy.data.objects:
    if _o.get("clock_hand"):
        _o.visible_shadow = _o.visible_diffuse = _o.visible_glossy = _o.visible_transmission = False


# ---------------------------------------------------------------- copied from s5_bake.py
# (it bakes at import, so it cannot be imported; the same helpers, unchanged except that bake() grows no margin: who is
# baked where, target image nodes, empty images, EXR saving, the bake call, the compositor denoise, the proxies)
def face_atlas_names(o):
    slots = [s.material for s in o.material_slots] or [None]
    return [atlas_of_material(o, m) for m in slots]


members = {}
for o in mesh_objects():
    if o.name == VIEW_OBJ or not len(o.data.polygons):
        continue
    hid = np.zeros(len(o.data.polygons), bool); o.data.attributes["web_hidden"].data.foreach_get("value", hid)
    mi = np.empty(len(o.data.polygons), np.int32); o.data.polygons.foreach_get("material_index", mi)
    names = face_atlas_names(o)
    used = {names[min(i, len(names) - 1)] for i in np.unique(mi[~hid])} if (~hid).any() else set()
    for a in used - {None}:
        members.setdefault(a, []).append(o)

dummy = bpy.data.images.new("web_dummy", 8, 8, alpha=False, float_buffer=True)


def target_nodes(objs, atlas):
    mats = {}
    for o in objs:
        names = face_atlas_names(o)
        for i, s in enumerate(o.material_slots):
            if s.material:
                mats.setdefault(s.material.name, (s.material, set()))[1].add(names[i])
    nodes = {}
    for name, (m, atl) in mats.items():
        if not m.use_nodes:
            m.use_nodes = True
        nt = m.node_tree
        nd = nt.nodes.get("web_bake_target") or nt.nodes.new("ShaderNodeTexImage")
        nd.name = "web_bake_target"; nd.label = "web bake target"
        for n in nt.nodes:
            n.select = False
        nd.select = True; nt.nodes.active = nd
        nodes[name] = (nd, atlas in atl and len(atl) == 1)
        if atlas in atl and len(atl) > 1:
            nodes[name] = (nd, True)
    return nodes


def set_target(nodes, img):
    for nd, mine in nodes.values():
        nd.image = img if mine else dummy


EMPTY = -1.0


def new_image(name, size, alpha=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=True)
    img.pixels.foreach_set(np.full(size * size * 4, EMPTY, np.float32))
    return img


def save_exr(img, path):
    img.filepath_raw = path; img.file_format = "OPEN_EXR"
    try:
        img.use_half_precision = True
    except Exception:
        pass
    img.save()


def bake(objs, kind, samples, img, **kw):
    sc.cycles.samples = samples
    select_only(objs)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["BakeUV"]
    t = time.time()
    with override(objs, objs[0]):
        bpy.ops.object.bake(type=kind, margin=0, use_clear=False, target="IMAGE_TEXTURES", **kw)
    return time.time() - t


def denoise(src, dst, normal=None):
    img = bpy.data.images.load(src, check_existing=False); w, h = img.size
    nimg = bpy.data.images.load(normal, check_existing=False) if normal else None
    ds = bpy.data.scenes.get("web_denoise") or bpy.data.scenes.new("web_denoise")
    if not ds.camera:
        cam = bpy.data.objects.new("web_dn_cam", bpy.data.cameras.new("web_dn_cam")); ds.collection.objects.link(cam); ds.camera = cam
    ng = bpy.data.node_groups.new("web_dn", "CompositorNodeTree"); ds.compositing_node_group = ng
    ni = ng.nodes.new("CompositorNodeImage"); ni.image = img
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor"); no = ng.nodes.new("NodeGroupOutput")
    nd = ng.nodes.new("CompositorNodeDenoise")
    ng.links.new(ni.outputs[0], nd.inputs["Image"])
    if nimg:
        nn = ng.nodes.new("CompositorNodeImage"); nn.image = nimg
        ng.links.new(nn.outputs[0], nd.inputs["Normal"])
    ng.links.new(nd.outputs[0], no.inputs[0])
    ds.render.resolution_x, ds.render.resolution_y, ds.render.resolution_percentage = w, h, 100
    ds.render.use_compositing = True; ds.render.use_sequencer = False
    s = ds.render.image_settings; s.file_format = "OPEN_EXR"; s.color_depth = "16"; s.color_mode = "RGB"
    try:
        s.exr_codec = "ZIP"
    except Exception:
        pass
    ds.render.filepath = dst
    bpy.ops.render.render(write_still=True, scene=ds.name)
    bpy.data.images.remove(img)
    if nimg:
        bpy.data.images.remove(nimg)
    bpy.data.node_groups.remove(ng)


VIS = ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow", "is_holdout")


def make_proxies(objs):
    groups = {}
    for o in objs:
        me = o.data
        sig = (tuple(l.name for l in me.uv_layers), next((l.name for l in me.uv_layers if l.active_render), ""),
               tuple(getattr(o, k) for k in VIS))
        groups.setdefault(sig, []).append(o)
    proxies = []
    for k, group in enumerate(groups.values()):
        copies = []
        for o in group:
            c = o.copy(); c.data = o.data.copy(); c.parent = None; c.matrix_world = o.matrix_world.copy()
            sc.collection.objects.link(c); copies.append(c)
        for o in group:
            o.hide_render = True
        if len(copies) > 1:
            with override(copies, copies[0]):
                bpy.ops.object.join()
        copies[0].name = f"web_proxy_{k}"
        proxies.append(copies[0])
    return proxies


def drop_proxies(proxies, objs):
    for p in proxies:
        me = p.data; bpy.data.objects.remove(p, do_unlink=True); bpy.data.meshes.remove(me)
    for o in objs:
        o.hide_render = False


# ---------------------------------------------------------------- the light sources, one group at a time
class LightState:
    """Every light source of the scene as it is now, and how to leave only one group of them on."""

    def __init__(self):
        self.spots = {o.name: o.data.energy for o in bpy.data.objects
                      if o.type == "LIGHT" and o.name.startswith("CeilingLamp_") and not o.hide_render}
        self.sun = bpy.data.objects["Sun_Daylight"].data; self.sun_energy = self.sun.energy
        self.sky = sc.world.node_tree.nodes["Background"].inputs["Strength"]; self.sky_strength = self.sky.default_value
        # the outside panorama: strength = (not a camera ray) x inputs[1] + inputs[2]
        day = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"]
        self.day = [day.inputs[1], day.inputs[2]]; self.day_values = [s.default_value for s in self.day]
        # every emitting surface: (material, strength socket, its value, what drove it): Principled emission or an
        # Emission node; the panorama is handled above
        self.emit = []
        for m in bpy.data.materials:
            if not m.use_nodes or not m.node_tree or m.name == "WindowView_Emission":
                continue
            for n in m.node_tree.nodes:
                s = n.inputs["Emission Strength"] if n.type == "BSDF_PRINCIPLED" else n.inputs["Strength"] if n.type == "EMISSION" else None
                if s is None:
                    continue
                link = s.links[0].from_socket if s.is_linked else None
                if link is None and s.default_value <= 0:
                    continue
                self.emit.append((m, s, s.default_value, link))
        glow = sorted(m.name for m, _, _, _ in self.emit if self.is_glow(m.name))
        say(f"light groups: {len(self.spots)} spots, glow materials {glow}, {len(self.emit) - len(glow)} other emitters "
            f"(off in every group), sun {self.sun_energy}, sky {self.sky_strength:.3f}, panorama {self.day_values}")

    @staticmethod
    def is_glow(name):
        return name.startswith("CeilingLamp_") and "Glow" in name

    def set_group(self, g, blockers):
        """Only group g's light sources on: a lamp's spots and glow; a window's sky and panorama (the other two
        windows blocked); the sun alone (no blockers); or every other emitter."""
        lamp = g in LAMPS; pre = LAMPS.get(g, "")
        window = g.startswith("win_"); sun = g == "sun"; other = g == REST_GROUP
        for name, e in self.spots.items():
            bpy.data.objects[name].data.energy = e if lamp and name.startswith(pre) else 0.0
        for m, s, v, link in self.emit:
            glow = self.is_glow(m.name)
            on = (lamp and glow and m.name.startswith(pre)) or (other and not glow)
            if on:
                s.default_value = v
                if link is not None and not s.is_linked:
                    m.node_tree.links.new(link, s)
            else:
                for l in list(s.links):
                    m.node_tree.links.remove(l)
                s.default_value = 0.0
        self.sun.energy = self.sun_energy if sun else 0.0
        self.sky.default_value = self.sky_strength if window else 0.0
        for s, v in zip(self.day, self.day_values):
            s.default_value = v if window else 0.0
        for w, b in blockers.items():                # a window: the other two blocked; the sun: none; else all
            b.hide_render = (window and g == f"win_{w}") or sun or other

    def restore(self, blockers):
        for name, e in self.spots.items():
            bpy.data.objects[name].data.energy = e
        for m, s, v, link in self.emit:
            s.default_value = v
            if link is not None and not s.is_linked:
                m.node_tree.links.new(link, s)
        self.sun.energy = self.sun_energy; self.sky.default_value = self.sky_strength
        for s, v in zip(self.day, self.day_values):
            s.default_value = v
        for b in blockers.values():
            b.hide_render = True


def make_blockers():
    """A black quad just outside each window frame (hidden until a group needs it): daylight through that window stays
    out. Its plane: along the sashes and up; outward = from the room's middle to the frame, perpendicular to that."""
    mat = bpy.data.materials.get("web_blocker") or bpy.data.materials.new("web_blocker")
    mat.use_nodes = True; nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
    bsdf.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0); bsdf.inputs["Roughness"].default_value = 1.0
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    blockers = {}
    for w, (_, _, frame_name) in BLINDS.items():
        frame = bpy.data.objects[frame_name]
        corners = [frame.matrix_world @ Vector(c) for c in frame.bound_box]
        c = sum(corners, Vector()) / 8
        sl = wcenter(bpy.data.objects[f"Window_{w}_Sash_L"]); sr = wcenter(bpy.data.objects[f"Window_{w}_Sash_R"])
        along = Vector((sr.x - sl.x, sr.y - sl.y, 0.0)).normalized()
        outward = Vector((c.x - CENTER.x, c.y - CENTER.y, 0.0)); outward -= along * outward.dot(along); outward.normalize()
        half = max(abs((p - c).dot(along)) for p in corners) + BLOCKER_MARGIN
        z0 = min(p.z for p in corners) - BLOCKER_MARGIN; z1 = max(p.z for p in corners) + BLOCKER_MARGIN
        c = c + outward * BLOCKER_OUT
        me = bpy.data.meshes.new(f"web_blocker_{w}")
        me.from_pydata([(c.x + along.x * s * half, c.y + along.y * s * half, z) for s, z in ((-1, z0), (1, z0), (1, z1), (-1, z1))],
                       [], [(0, 1, 2, 3)])
        me.materials.append(mat)
        o = bpy.data.objects.new(me.name, me); sc.collection.objects.link(o); o.hide_render = True
        blockers[w] = o
        say(f"blocker {w}: middle ({c.x:.3f}, {c.y:.3f}), outward ({outward.x:.3f}, {outward.y:.3f}), {2 * half:.2f} x {z1 - z0:.2f} m")
    return blockers


# ---------------------------------------------------------------- full size -> map size
def map_size(a):
    size = ATLAS[a]; rs = max(MIN_SIZE, size // DIV)
    return size, rs, size // rs


def downsample(x, cov, div):
    """Box filter by div over the covered texels only. x (h, w, c), cov (h, w) -> (x_small, covered texels per block)."""
    h, w, c = x.shape
    xs = (x * cov[..., None]).reshape(h // div, div, w // div, div, c).sum((1, 3))
    cnt = cov.reshape(h // div, div, w // div, div).sum((1, 3))
    return xs / np.maximum(cnt, 1)[..., None], cnt


def fill(x, cov):
    """Give the texels no face covers the values of covered ones nearby (exact neighbours first, then pull-push), so
    bilinear filtering and the mipmaps at island borders never mix in black."""
    x = np.where(cov[..., None], x, 0.0).astype(np.float32); cov = cov.copy()
    h, w, _ = x.shape
    for _ in range(4):
        acc = np.zeros_like(x); cnt = np.zeros((h, w), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = (slice(max(dy, 0), h + min(dy, 0)), slice(max(dx, 0), w + min(dx, 0)))
            dst = (slice(max(-dy, 0), h + min(-dy, 0)), slice(max(-dx, 0), w + min(-dx, 0)))
            acc[dst] += x[src]; cnt[dst] += cov[src]
        grow = ~cov & (cnt > 0)
        if not grow.any():
            break
        x[grow] = acc[grow] / cnt[grow][:, None]; cov |= grow
    if cov.all():
        return x
    if h < 2 or w < 2 or h % 2 or w % 2:
        x[~cov] = x[cov].mean(0) if cov.any() else 0.0
        return x
    cs = cov.reshape(h // 2, 2, w // 2, 2); cnt = cs.sum((1, 3))
    d = x.reshape(h // 2, 2, w // 2, 2, -1).sum((1, 3)) / np.maximum(cnt, 1)[..., None]
    up = np.repeat(np.repeat(fill(d, cnt > 0), 2, 0), 2, 1)
    x[~cov] = up[~cov]
    return x


def guided(L, lt, nrm, ok, R=3, sl=0.2, sn=0.1, ss=2.0):
    """Each group's light averaged over the neighbours (within R texels) whose full-bake luminance (within about
    1.2x) and normal are alike, over the full bake's light averaged the same way -> fractions. Bounce light is smooth,
    so this takes the sampling noise out of the maps, while the edges of direct light (a sun patch, a lamp's cone)
    show in the full bake's luminance and are kept. L (h, w, k), lt (h, w), nrm (h, w, 3), ok (h, w)."""
    h, w, k = L.shape
    num = np.zeros((h, w, k), np.float32); den = np.zeros((h, w), np.float32)
    loglt = np.log(np.maximum(lt, 1e-5)).astype(np.float32)
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            src = (slice(max(dy, 0), h + min(dy, 0)), slice(max(dx, 0), w + min(dx, 0)))
            dst = (slice(max(-dy, 0), h + min(-dy, 0)), slice(max(-dx, 0), w + min(-dx, 0)))
            dl = loglt[src] - loglt[dst]
            dn = ((nrm[src] - nrm[dst]) ** 2).sum(2)
            wgt = np.exp(-dl * dl / (2 * sl * sl) - dn / (2 * sn * sn) - (dx * dx + dy * dy) / (2 * ss * ss)) * ok[src]
            num[dst] += wgt[..., None] * L[src]
            den[dst] += wgt * lt[src]
    return num / np.maximum(den, 1e-6)[..., None]


def save_small(rgb, path, name="web_small"):
    """A (rs, rs, 3) float array -> EXR (through a throw-away image)."""
    rs = rgb.shape[0]
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, rs, rs, alpha=False, float_buffer=True)
    px = np.ones((rs, rs, 4), np.float32); px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel()); save_exr(img, path); bpy.data.images.remove(img)


def shrink(img, div):
    """A baked full-size image -> box-filtered over the texels the bake wrote, the rest filled from neighbours; and
    how much of each block the bake wrote (0..1)."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    done = px[..., 0] > EMPTY / 2
    small, cnt = downsample(np.where(done[..., None], px[..., :3], 0.0).astype(np.float32), done, div)
    return fill(small, cnt > 0), cnt.astype(np.float32) / (div * div)


def coverage(a):
    """The full bake's coverage (its padded islands) from its normal map, which also becomes the denoiser's guide."""
    size, rs, div = map_size(a)
    nrm = load_pixels(os.path.join(BAKE_DIR, f"{a}_normal.exr"))[..., :3]
    cov = nrm.any(axis=2)                        # black = no face
    guide = os.path.join(BAKE_DIR, f"{a}_g_normal.exr")
    if FORCE or not os.path.exists(guide):
        small, cnt = downsample(nrm, cov, div)
        save_small(fill(small, cnt > 0), guide, f"G_{a}_normal")
    return cov


# ---------------------------------------------------------------- the bakes
def bake_atlas(a, L, blockers):
    size, rs, div = map_size(a)
    spp = max(1, SAMPLES)
    P = lambda k: os.path.join(BAKE_DIR, f"{a}_g_{k}.exr")
    todo = [g for g in GROUPS if FORCE or not os.path.exists(P(g))] + (["check_all"] if CHECK else [])
    # a lamp's own glow, where its glow materials are: an EMIT bake with only that glow on (no sampling noise)
    glow_atlas = any(L.is_glow(sl.material.name) for o in members[a] for sl in o.material_slots if sl.material)
    emits = [g for g in LAMPS if glow_atlas and (FORCE or not os.path.exists(P(g + "_emit")))]
    skipped = [g for g in GROUPS if g not in todo]
    if skipped:
        say(f"  {a}: {skipped} exist, skipped")
    if not todo and not emits:
        return
    t0 = time.time()
    objs = members[a]
    nodes = target_nodes(objs, a)
    originals = objs
    objs = make_proxies(originals)
    say(f"  {a}: {len(originals)} objects baked as {len(objs)} joined proxies, {size}px at {spp} spp -> {rs}px")
    times = {}
    try:
        for g in todo:
            img = new_image(f"G_{a}_{g}", size); set_target(nodes, img)
            if g != "check_all":                     # check_all: everything on, as the full bake
                L.set_group(g, blockers)
            try:
                t = bake(objs, "DIFFUSE", spp, img, pass_filter={"DIRECT", "INDIRECT"})
            finally:
                L.restore(blockers)
            small, cover = shrink(img, div); bpy.data.images.remove(img)
            raw = P(g + "_raw"); save_small(small, raw, f"G_{a}_{g}_small")
            denoise(raw, P(g), normal=P("normal")); os.remove(raw)
            if FORCE or not os.path.exists(P("cover")):   # the bakes' own coverage (the same for every group)
                save_small(np.repeat(cover[..., None], 3, 2), P("cover"), f"G_{a}_cover")
            times[g] = t
        for g in emits:
            img = new_image(f"G_{a}_{g}_emit", size); set_target(nodes, img)
            L.set_group(g, blockers)
            try:
                t = bake(objs, "EMIT", 1, img)
            finally:
                L.restore(blockers)
            small, _ = shrink(img, div); bpy.data.images.remove(img)
            save_small(small, P(g + "_emit"), f"G_{a}_{g}_emit_small")
            times[g + "_emit"] = t
    finally:
        for nd, _ in nodes.values():
            nd.id_data.nodes.remove(nd)
        drop_proxies(objs, originals)
    say(f"group bakes {a}: {size}px at {spp} spp -> {rs}px: " + ", ".join(f"{k} {v:.1f}s" for k, v in times.items())
        + f"; total {time.time() - t0:.0f}s")


# ---------------------------------------------------------------- the fraction maps
def fractions(a, stats, cov):
    size, rs, div = map_size(a)
    P = lambda k: os.path.join(BAKE_DIR, f"{a}_{k}.exr")
    G = lambda k: os.path.join(BAKE_DIR, f"{a}_g_{k}.exr")
    t0 = time.time()
    light, cnt = downsample(load_pixels(P("light"))[..., :3], cov, div)
    albedo, _ = downsample(load_pixels(P("albedo"))[..., :3], cov, div)
    emit, _ = downsample(load_pixels(P("emit"))[..., :3], cov, div)
    covered = cnt > 0
    lt = light @ LUM
    ok = covered & (lt > 1e-4)
    L = np.zeros((rs, rs, len(ALL)), np.float32)      # each group's light, luminance
    sums = {"texels": int(ok.sum()), "groups": {}}
    for i, g in enumerate(ALL):
        if not os.path.exists(G(g)):
            say(f"  WARNING {a}: {g} is not baked, its fraction is 0"); sums["groups"][g] = [0.0, 0.0, 0.0]; continue
        Lg = np.maximum(load_pixels(G(g))[..., :3], 0.0)
        if Lg.shape[:2] != (rs, rs):
            raise RuntimeError(f"{G(g)} is {Lg.shape[1]}px, expected {rs}px (baked with another --div?): use --force")
        L[..., i] = np.where(ok, Lg @ LUM, 0.0)
        sums["groups"][g] = Lg[ok].sum(0).tolist()
    sums["total"] = np.sum([sums["groups"][g] for g in ALL], axis=0).tolist()   # all the light = the groups together
    s = np.where(ok, L.sum(2) / np.maximum(lt, 1e-4), 0.0)
    # how the bakes compare with the full bake, on the texels well inside the islands (every atlas texel of the block
    # baked), by the full bake's brightness
    inner = ok & (load_pixels(G("cover"))[..., 0] > 0.999) if os.path.exists(G("cover")) else ok
    pct = lambda r: " / ".join(f"{v:.3f}" for v in np.percentile(r, [10, 50, 90])) if len(r) else "-"
    bands = (("dark", 1e-4, 0.05), ("mid", 0.05, 0.3), ("bright", 0.3, 1e9))
    say(f"  {a}: groups / full bake, luminance-weighted {(s * lt)[ok].sum() / lt[ok].sum():.3f}; per texel 10 / 50 / 90 % inside the islands: "
        + ", ".join(f"{nm} {pct(s[inner & (lt > lo) & (lt <= hi)])}" for nm, lo, hi in bands))
    if os.path.exists(G("check_all")):
        al = np.maximum(load_pixels(G("check_all"))[..., :3], 0.0) @ LUM
        say(f"  {a}: everything on with these settings / full bake, luminance-weighted {al[ok].sum() / lt[ok].sum():.3f}; "
            f"per texel 10 / 50 / 90 % inside the islands: "
            + ", ".join(f"{nm} {pct((al / np.maximum(lt, 1e-4))[inner & (lt > lo) & (lt <= hi)])}" for nm, lo, hi in bands)
            + f"; groups / everything on {(s * lt)[ok].sum() / al[ok].sum():.3f}")
    # the maps: each group's light smoothed over the neighbours alike in the full bake (twice: as wide as it needs for
    # the bounce-lit texels), a firefly in one group's bake cut to the full bake's level first; then each group's share
    # of the groups' own sum (they add up to 1 exactly: with everything off nothing of the noise between the group
    # bakes and the full bake is left)
    nrm = load_pixels(G("normal"))[..., :3].astype(np.float32)
    f = guided(np.minimum(L, 1.25 * lt[..., None]), lt, nrm, ok)
    f = np.maximum(guided(f * lt[..., None], lt, nrm, ok), 0.0)
    f = f / np.maximum(f.sum(2), 1e-6)[..., None]
    # of the texel's colour, not its light: a texel's own emission (screens, LEDs) takes nothing from any group and so
    # stays as it is; a lamp's own glow (its EMIT bake) goes to that lamp
    col = np.maximum((light * albedo + emit) @ LUM, 1e-6)
    ge = np.where(covered, np.clip((emit @ LUM) / col, 0.0, 1.0), 0.0)
    f = f * (1.0 - ge)[..., None]
    glow = {}
    for i, g in enumerate(LAMPS):
        if os.path.exists(G(g + "_emit")):
            e = np.maximum(load_pixels(G(g + "_emit"))[..., :3], 0.0) @ LUM
            gi = np.where(covered, np.clip(e / col, 0.0, 1.0), 0.0)
            f[..., i] += gi; glow[g] = float(gi[covered].mean())
    f = np.clip(f[..., :len(LIGHT_GROUPS)], 0.0, 1.0)
    sf = f.sum(2)
    f = np.where((sf > 1.0)[..., None], f / np.maximum(sf, 1.0)[..., None], f)
    f = fill(f, ok)
    u8 = np.round(np.sqrt(np.clip(f, 0, 1)) * 255).astype(np.uint8)
    write_png(os.path.join(TEX_DIR, f"{a}_lamps.png"), np.ascontiguousarray(u8[..., 0:4]))
    write_png(os.path.join(TEX_DIR, f"{a}_day.png"), np.ascontiguousarray(u8[..., 4:8]))
    stats[a] = sums
    say(f"fractions {a}: {rs}px, {int(ok.sum())} texels, groups / full bake {s[ok].mean():.3f} on average: "
        + ", ".join(f"{g} {f[..., i][ok].mean():.3f}" for i, g in enumerate(LIGHT_GROUPS))
        + f", {REST_GROUP} {(1 - sf)[ok].mean():.3f}, emission {ge[covered].mean():.3f}"
        + (f", glow {', '.join(f'{g} {v:.3f}' for g, v in glow.items())}" if glow else "") + f", {time.time() - t0:.0f}s")


def write_stats(stats):
    """groups.json: tint (a group's colour / all light's colour, both at luminance 1) and probe (its share of all the
    light: the groups together) over the baked texels of every atlas with sums on file, this run's atlases replacing
    their old sums; "encoding": the maps hold sqrt(fraction)."""
    path = os.path.join(BAKE_DIR, "groups.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    per = old.get("atlases", {}); per.update(stats)
    n = sum(s["texels"] for s in per.values())
    tot = sum((np.array(s["total"]) for s in per.values()), np.zeros(3))
    cT = tot / max(n, 1); lT = float(cT @ LUM); cT = cT / max(lT, 1e-9)
    tint, probe = {}, {}
    for g in ALL:
        cg = sum((np.array(s["groups"].get(g, [0, 0, 0])) for s in per.values()), np.zeros(3)) / max(n, 1)
        lg = float(cg @ LUM)
        tint[g] = [round(float(v), 4) for v in (cg / max(lg, 1e-9) / cT)] if lg > 0 else [1.0, 1.0, 1.0]
        probe[g] = round(lg / max(lT, 1e-9), 4)
    json.dump({"names": list(LIGHT_GROUPS), "rest": REST_GROUP, "encoding": "sqrt", "tint": tint, "probe": probe,
               "div": DIV, "samples": SAMPLES, "atlases": per}, open(path, "w"), indent=1)
    say(f"groups.json over {sorted(per)}: tint {tint}, probe {probe} (sum {sum(probe.values()):.3f})")


def check_lamps(a="Lighting"):
    """The lamp fractions on each lamp's own heads and plate (mostly its own channel: its glow, if all went right)."""
    if a not in members or not os.path.exists(os.path.join(TEX_DIR, f"{a}_lamps.png")):
        return
    png = load_pixels(os.path.join(TEX_DIR, f"{a}_lamps.png"), raw=True) ** 2; rs = png.shape[0]
    for g, pre in LAMPS.items():
        vals = []
        for o in members[a]:
            if not o.name.startswith(pre):
                continue
            me = o.data; uv = me.uv_layers["BakeUV"]
            u = np.empty(len(uv.data) * 2, np.float32); uv.data.foreach_get("uv", u); u = u.reshape(-1, 2)
            ls = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_start", ls)
            lt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", lt)
            hid = np.zeros(len(me.polygons), bool); me.attributes["web_hidden"].data.foreach_get("value", hid)
            c = np.add.reduceat(u, ls, axis=0) / lt[:, None]
            c = c[~hid]
            x = np.clip((c[:, 0] * rs).astype(int), 0, rs - 1); y = np.clip((c[:, 1] * rs).astype(int), 0, rs - 1)
            vals.append(png[y, x, :4])
        if vals:
            say(f"  check {g} heads + plate ({a}): lamp fractions {np.round(np.concatenate(vals).mean(0), 3).tolist()}")


def main():
    t0 = time.time()
    unknown = [a for a in ONLY if a not in members]
    if unknown:
        say(f"WARNING unknown atlases {unknown}")
    order = [a for a in ONLY if a in members] or [a for a in sorted(members) if a in ATLAS]   # not the cables ("Vertex")
    say(f"groups: {order}, div {DIV}, {SAMPLES} spp ({SAMPLES * DIV * DIV} paths per map texel), groups {GROUPS}{', force' if FORCE else ''}"
        f"{', fast bounces' if FAST else ''}{', check' if CHECK else ''}")
    L = LightState(); blockers = make_blockers()
    stats = {}
    for a in order:
        cov = coverage(a)
        bake_atlas(a, L, blockers)
        fractions(a, stats, cov)
        del cov
        write_stats(stats)
        if a == "Lighting":
            check_lamps(a)
    say(f"groups done: {order}, {time.time() - t0:.0f}s")


try:
    main()
    print("GROUPS_DONE", flush=True)
except Exception:
    traceback.print_exc(); sys.stdout.flush()
    print("GROUPS_FAILED", flush=True)
