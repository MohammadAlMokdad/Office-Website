# Step 5 (background): bake the atlases.
#   blender -b Office_bake.blend -P run.py -- s5_bake.py [--atlas A,B] [--samples 512] [--vertex]
# Per atlas, into build/bake/ (scene-linear EXR):
#   <a>_light.exr   diffuse light (direct + bounce, without the surface colour), OIDN-denoised with normal guide
#   <a>_albedo.exr  diffuse colour          <a>_emit.exr  emission          <a>_normal.exr  object-space normal (guide)
#   <a>_f0.exr      specular colour at normal incidence, <a>_rough.exr roughness   (half size, for live reflections)
#   Alpha_alpha.exr opacity (Alpha atlas only)
# --vertex: the cables, baked into vertex colours -> build/bake/vertex_<object>.npz
import sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
ONLY = set(filter(None, (arg("--atlas", "") or "").split(",")))
SAMPLES = int(arg("--samples", "512"))
VERTEX = "--vertex" in argv
PASSES = set((arg("--passes", "") or "normal,albedo,emit,light,f0,rough,alpha,ao").split(","))
AO_DISTANCE = 0.6               # metres: specular occlusion only cares about nearby surfaces
sc = bpy.context.scene
setup_cycles(SAMPLES)
sc.cycles.use_denoising = False
sc.render.bake.margin_type = "ADJACENT_FACES"
info = json.loads(sc["web_atlases"])
# the clock hands turn in the app: they must not leave shadows at the modelled time (ghost hands) on the wall or clock
for _o in bpy.data.objects:
    if _o.get("clock_hand"):
        _o.visible_shadow = _o.visible_diffuse = _o.visible_glossy = _o.visible_transmission = False

# ---------------------------------------------------------------- who is baked where
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
    """One image node per material, active: the atlas image for this atlas's materials, a dummy for the rest."""
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
            log(f"  WARNING material {name} is baked into several atlases {atl}; using {atlas}")
            nodes[name] = (nd, True)
    return nodes


def set_target(nodes, img):
    for nd, mine in nodes.values():
        nd.image = img if mine else dummy


EMPTY = -1.0                                     # texels no face covers keep this (no bake writes a negative value)


def new_image(name, size, alpha=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=True)      # scene-linear
    img.pixels.foreach_set(np.full(size * size * 4, EMPTY, np.float32))
    return img


def pad(img, n):
    """Grow every island by n texels into texels no face covers. Blender writes each object's bake margin right after
    baking it, over the islands of the objects baked before (islands sit 2 texels apart): the joined proxies painted
    over each other's borders (dark notches on the cups' rims). So the bake runs without a margin and it is grown
    here, never over a baked texel."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    done = px[..., 0] > EMPTY / 2
    rgb = np.where(done[..., None], px[..., :3], 0.0).astype(np.float32)
    for _ in range(n):
        acc = np.zeros_like(rgb); cnt = np.zeros((h, w), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = (slice(max(dy, 0), h + min(dy, 0)), slice(max(dx, 0), w + min(dx, 0)))
            dst = (slice(max(-dy, 0), h + min(-dy, 0)), slice(max(-dx, 0), w + min(-dx, 0)))
            acc[dst] += rgb[src]; cnt[dst] += done[src]
        grow = ~done & (cnt > 0)
        if not grow.any():
            break
        rgb[grow] = acc[grow] / cnt[grow][:, None]; done |= grow
    px[..., :3] = rgb; px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())


def save_exr(img, path):
    img.filepath_raw = path; img.file_format = "OPEN_EXR"
    try:
        img.use_half_precision = True
    except Exception:
        pass
    img.save()


def bake(objs, kind, samples, margin, img, **kw):
    sc.cycles.samples = samples
    select_only(objs)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["BakeUV"]
    t = time.time()
    with override(objs, objs[0]):
        bpy.ops.object.bake(type=kind, margin=0, use_clear=False, target="IMAGE_TEXTURES", **kw)
    pad(img, margin)
    return time.time() - t


# ---------------------------------------------------------------- material swaps for the reflection maps
def principled_of(m):
    nt = m.node_tree
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or \
        next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if out is None:
        return None, None
    bs = None
    if out.inputs["Surface"].is_linked:
        n = out.inputs["Surface"].links[0].from_node
        bs = n if n.type == "BSDF_PRINCIPLED" else None
    return bs or next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None), out


def feed(nt, sock_from, value, to):
    """Connect a Principled input (its link if any, else its value) into `to`."""
    if sock_from is not None and sock_from.is_linked:
        nt.links.new(sock_from.links[0].from_socket, to)
    else:
        v = sock_from.default_value if sock_from is not None else value
        if hasattr(to, "default_value"):
            try:
                to.default_value = v
            except TypeError:
                to.default_value = (v, v, v, 1.0) if isinstance(v, float) else v


def swap_emission(mats, what):
    """Temporarily replace each material's surface by an emission of: f0 / rough / alpha. Returns an undo list."""
    undo = []
    for m in mats:
        bs, out = principled_of(m)
        if out is None:
            continue
        nt = m.node_tree
        prev = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = 1.0
        made = [em]
        if bs is None:
            em.inputs["Color"].default_value = {"f0": (0.04, 0.04, 0.04, 1), "rough": (0.6, 0.6, 0.6, 1), "alpha": (1, 1, 1, 1)}[what]
        elif what == "f0":
            ior = bs.inputs["IOR"].default_value; level = bs.inputs["Specular IOR Level"].default_value
            f0d = ((ior - 1) / (ior + 1)) ** 2 * 2 * level
            tint = bs.inputs["Specular Tint"].default_value
            coat = bs.inputs["Coat Weight"].default_value if not bs.inputs["Coat Weight"].is_linked else 0.0
            coat = SPEC_OVERRIDE.get(m.name, {}).get("coat", coat)
            f0d = f0d + 0.04 * coat
            mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MIX"; made.append(mix)
            mix.inputs["A"].default_value = (f0d * tint[0], f0d * tint[1], f0d * tint[2], 1)
            if bs.inputs["Specular Tint"].is_linked:      # a tint map scales the reflection (Xbox: IOR 1000, black tint)
                tm = nt.nodes.new("ShaderNodeMix"); tm.data_type = "RGBA"; tm.blend_type = "MULTIPLY"; made.append(tm)
                tm.inputs["Factor"].default_value = 1.0
                tm.inputs["A"].default_value = (f0d, f0d, f0d, 1)
                feed(nt, bs.inputs["Specular Tint"], None, tm.inputs["B"])
                nt.links.new(tm.outputs["Result"], mix.inputs["A"])
            feed(nt, bs.inputs["Metallic"], 0.0, mix.inputs["Factor"])
            feed(nt, bs.inputs["Base Color"], (0.8, 0.8, 0.8, 1), mix.inputs["B"])
            nt.links.new(mix.outputs["Result"], em.inputs["Color"])
        elif what == "rough" and "rough" in SPEC_OVERRIDE.get(m.name, {}):
            v = SPEC_OVERRIDE[m.name]["rough"]; em.inputs["Color"].default_value = (v, v, v, 1.0)
        elif what == "rough":
            coat = bs.inputs["Coat Weight"].default_value if not bs.inputs["Coat Weight"].is_linked else 0.0
            if coat > 0.05:                       # a clear coat makes the reflection sharper: blend toward its roughness
                mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "FLOAT"; made.append(mx)
                mx.inputs["Factor"].default_value = min(1.0, coat * 4)
                feed(nt, bs.inputs["Roughness"], 0.5, mx.inputs["A"])
                mx.inputs["B"].default_value = bs.inputs["Coat Roughness"].default_value
                nt.links.new(mx.outputs["Result"], em.inputs["Color"])
            else:
                feed(nt, bs.inputs["Roughness"], 0.5, em.inputs["Color"])
        elif what == "alpha":
            feed(nt, bs.inputs["Alpha"], 1.0, em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        undo.append((m, out, prev, made))
    return undo


def unswap(undo):
    for m, out, prev, made in undo:
        nt = m.node_tree
        for n in made:
            nt.nodes.remove(n)
        if prev is not None:
            nt.links.new(prev, out.inputs["Surface"])


# ---------------------------------------------------------------- denoise (compositor of a throw-away scene)
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
    if nimg:                                     # albedo guide left at white: the light pass has no surface colour
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


# ---------------------------------------------------------------- proxies
# Blender bakes every selected object as its own render job, re-syncing the whole scene each time (~3 s per object).
# So for the bake, an atlas's objects are swapped for a few joined copies: one per group of objects whose UV layers,
# render UV layer and ray visibility match (so every material still reads the same UVs). Same geometry, same light.
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


# ---------------------------------------------------------------- atlases
def bake_atlas(a):
    objs = members[a]; size = ATLAS[a]; half = max(512, size // 2)
    t0 = time.time()
    nodes = target_nodes(objs, a)
    originals = objs
    objs = make_proxies(originals)
    log(f"  {a}: {len(originals)} objects baked as {len(objs)} joined proxies")
    mats = [bpy.data.materials[n] for n, (_, mine) in nodes.items() if mine]
    P = lambda k: os.path.join(BAKE_DIR, f"{a}_{k}.exr")
    m = max(4, size // 512)                                   # bake margin in texels
    tl = 0.0
    if "normal" in PASSES or not os.path.exists(P("normal")):
        img = new_image(f"B_{a}_normal", size); set_target(nodes, img)
        bake(objs, "NORMAL", 1, m, img, normal_space="OBJECT"); save_exr(img, P("normal")); bpy.data.images.remove(img)
    if "albedo" in PASSES:
        img = new_image(f"B_{a}_albedo", size); set_target(nodes, img)
        bake(objs, "DIFFUSE", 16, m, img, pass_filter={"COLOR"}); save_exr(img, P("albedo")); bpy.data.images.remove(img)
    if "emit" in PASSES:
        img = new_image(f"B_{a}_emit", size); set_target(nodes, img)
        bake(objs, "EMIT", 16, m, img); save_exr(img, P("emit")); bpy.data.images.remove(img)
    if "light" in PASSES:
        img = new_image(f"B_{a}_light", size); set_target(nodes, img)
        tl = bake(objs, "DIFFUSE", SAMPLES, m, img, pass_filter={"DIRECT", "INDIRECT"})
        save_exr(img, P("light_raw")); bpy.data.images.remove(img)
        denoise(P("light_raw"), P("light"), normal=P("normal"))
    if "ao" in PASSES:                           # specular occlusion: geometry only, so black and metal surfaces get it too
        sc.world.light_settings.distance = AO_DISTANCE
        img = new_image(f"B_{a}_ao", size); set_target(nodes, img)
        bake(objs, "AO", 128, m, img); save_exr(img, P("ao_raw")); bpy.data.images.remove(img)
        denoise(P("ao_raw"), P("ao"), normal=P("normal"))
    for what, sz in tuple(x for x in (("f0", half), ("rough", half)) + ((("alpha", size),) if a == "Alpha" else ()) if x[0] in PASSES):
        img = new_image(f"B_{a}_{what}", sz); set_target(nodes, img)
        undo = swap_emission(mats, what)
        try:
            bake(objs, "EMIT", 8, max(2, m // 2), img)
        finally:
            unswap(undo)
        save_exr(img, P(what)); bpy.data.images.remove(img)
    for nd, _ in nodes.values():
        nd.id_data.nodes.remove(nd)
    drop_proxies(objs, originals)
    log(f"baked {a}: {len(originals)} objects, {size}px, {SAMPLES} spp light ({tl:.0f}s), total {time.time() - t0:.0f}s")


def bake_vertex():
    """Cables: light, colour and emission per face corner, saved as arrays (combined in s6)."""
    objs = [o for o in mesh_objects() if o.name.startswith(VERTEX_PREFIX)]
    t0 = time.time()
    res = {o.name: {} for o in objs}
    for kind, filt, spp in (("light", {"DIRECT", "INDIRECT"}, SAMPLES), ("albedo", {"COLOR"}, 16), ("emit", None, 16)):
        for o in objs:
            ca = o.data.color_attributes.get("web_bake") or o.data.color_attributes.new("web_bake", "FLOAT_COLOR", "CORNER")
            o.data.color_attributes.active_color = ca
        sc.cycles.samples = spp
        select_only(objs)
        with override(objs, objs[0]):
            if kind == "emit":
                bpy.ops.object.bake(type="EMIT", target="VERTEX_COLORS")
            else:
                bpy.ops.object.bake(type="DIFFUSE", pass_filter=filt, target="VERTEX_COLORS")
        for o in objs:
            ca = o.data.color_attributes["web_bake"]; a = np.empty(len(ca.data) * 4, np.float32); ca.data.foreach_get("color", a)
            res[o.name][kind] = a.reshape(-1, 4)[:, :3].copy()
    for name, d in res.items():
        np.savez_compressed(os.path.join(BAKE_DIR, f"vertex_{name}.npz"), **d)
    log(f"baked vertex colours: {[o.name for o in objs]}, {time.time() - t0:.0f}s")


if VERTEX:
    bake_vertex()
else:
    order = [a for a in (arg("--atlas", "") or "").split(",") if a in members] or sorted(members)
    for a in order:
        bake_atlas(a)
