# Step 2b (background): find parts modelled inside out, by looking at what each side of a face opens onto.
#   blender -b Office_bake.blend -P run.py -- s2_facing.py [--show Name1,Name2]
# Cycles renders shade whichever side faces the camera, so inverted normals never show in Blender, but a bake lights
# the side the normal points to: inside-out parts bake black. For sampled faces of every connected piece, rays go to
# places where a visitor's eye can be: a correct piece is seen from the front. Pieces seen mostly from the back are
# listed in build/flip.json (applied by s2_apply_flips.py).
# Check every listed object with check_facing.py before applying: thin labels stuck onto hollow shells can fool it
# (on this scene: the PC, a battery and the light case got worse; only visually verified objects were flipped).
import sys, random
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SHOW = set(argv[argv.index("--show") + 1].split(",")) if "--show" in argv else set()
PER_PIECE = 120              # faces sampled per connected piece
PER_FACE_EYES = 24           # eye positions tried per sampled face
t0 = time.time()
rng = random.Random(0)

objs = [o for o in mesh_objects() if o.name != VIEW_OBJ and len(o.data.polygons)]
# one BVH of the room in world space; see-through glass does not block
verts, polys = [], []
for o in objs:
    me = o.data; M = np.array(o.matrix_world)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
    base = len(verts); verts.extend(map(tuple, co))
    glass = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name in GLASS_MATS}
    for p in me.polygons:
        if p.material_index not in glass:
            polys.append([base + v for v in p.vertices])
bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
log(f"facing: BVH of {len(polys):,} faces, {time.time() - t0:.0f}s")


# where people's eyes can be: a grid over the walkable floor (outside furniture footprints), standing and sitting
col = json.load(open(os.path.join(BUILD, "collision.json")))
obst = [ob["poly"] for ob in col["obstacles"]]
EYES = []
xs = [p[0] for p in ROOM]; ys = [p[1] for p in ROOM]
for x in np.arange(min(xs) + 0.2, max(xs) - 0.1, 0.35):
    for y in np.arange(min(ys) + 0.2, max(ys) - 0.1, 0.35):
        if inside((x, y), ROOM) and not any(inside((x, y), q) for q in obst):
            for h in (1.15, EYE):
                EYES.append(Vector((x, y, FLOOR_Z + h)))
log(f"facing: {len(EYES)} eye positions")


def seen_from_room(c, n):
    """(front, back): fractions of sampled eye positions that see this side of the face unobstructed."""
    front = back = 0
    for e in rng.sample(EYES, PER_FACE_EYES):
        d = e - c; dist = d.length; d /= dist
        side = n.dot(d)
        if abs(side) < 0.05:
            continue
        o = c + n * (2e-4 if side > 0 else -2e-4)
        hit = bvh.ray_cast(o, d, dist - 0.01)
        if hit[0] is None:
            if side > 0:
                front += 1
            else:
                back += 1
    return front / PER_FACE_EYES, back / PER_FACE_EYES


flips, scores = {}, []
rays = 0
for o in objs:
    if {c.name for c in o.users_collection} & {"Structure"}:
        continue
    me = o.data; M = o.matrix_world; R = M.to_3x3().inverted().transposed()
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    glass = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name in GLASS_MATS}
    seen = np.zeros(len(bm.faces), bool)
    for f0 in bm.faces:
        if seen[f0.index]:
            continue
        stack = [f0]; seen[f0.index] = True; comp = []
        while stack:
            f = stack.pop(); comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if not seen[g.index]:
                        seen[g.index] = True; stack.append(g)
        if all(f.material_index in glass for f in comp):
            continue
        sample = comp if len(comp) <= PER_PIECE else rng.sample(comp, PER_PIECE)
        num = den = back_sum = 0.0
        for f in sample:
            a = f.calc_area()
            if a <= 0:
                continue
            c = M @ f.calc_center_median(); n = (R @ f.normal).normalized()
            fv, bv = seen_from_room(c, n); rays += PER_FACE_EYES
            num += a * fv; den += a; back_sum += a * bv
        if den <= 0:
            continue
        front_seen, back_seen = num / den, back_sum / den
        if o.name in SHOW:
            scores.append(f"  {o.name}: piece of {len(comp)} faces, front seen {front_seen:.2f}, back seen {back_seen:.2f}")
        if back_seen > 0.02 and back_seen > 3 * front_seen:
            flips.setdefault(o.name, []).extend(f.index for f in comp)
    bm.free()
for s in scores[:80]:
    print(s)
json.dump(flips, open(os.path.join(BUILD, "flip.json"), "w"))
for name, idx in sorted(flips.items()):
    log(f"  inside out: {name} ({group_of(bpy.data.objects[name])}): {len(idx)} of {len(bpy.data.objects[name].data.polygons)} faces")
log(f"facing: {len(flips)} objects with inside-out parts, {rays:,} rays, {time.time() - t0:.0f}s -> build/flip.json")
