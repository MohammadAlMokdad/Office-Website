# The paper cups (desk cups and the stack by the coffee machine) come inside-out from the source model: the inner wall
# and the inner bottom face outward, so the bake looked into the 1 mm gap between the walls and painted the inside black.
# Flips exactly those faces (idempotent) and saves; then re-bake the atlases it prints.
#   blender -b Office_bake.blend -P run.py -- s7_cups.py
if not bpy.app.background:
    live_guard()
done, atlases = [], set()
for o in mesh_objects():
    mats = {s.material.name for s in o.material_slots if s.material}
    if not {"MhmdDesk_CupPaper", "MhmdDesk_CupPrint"} <= mats:
        continue
    me = o.data; paper = [i for i, s in enumerate(o.material_slots) if s.material and s.material.name == "MhmdDesk_CupPaper"]
    bad = []
    for p in me.polygons:
        if p.material_index not in paper:
            continue
        vs = [me.vertices[i].co for i in p.vertices]
        if max(Vector((v.x, v.y)).length for v in vs) > 0.04405 or max(v.z for v in vs) > 0.1112:
            continue                                   # the rim roll: already right
        c = p.center; rad = Vector((c.x, c.y, 0))
        out = p.normal.dot(rad.normalized()) if rad.length > 1e-5 else 0.0
        if out > 0.3 or p.normal.z < -0.7:             # inner wall facing out / inner bottom facing down
            bad.append(p.index)
    if bad:
        flip_faces(o, bad); done.append(f"{o.name} {len(bad)}")
    o["web_cup_inner"] = 1                             # s2_reset_orientation leaves these alone
    atlases |= {atlas_of_material(o, s.material) for s in o.material_slots}
log("cups flipped:", done)
log("re-bake atlases:", ",".join(sorted(a for a in atlases if a)))
bpy.ops.wm.save_mainfile()
