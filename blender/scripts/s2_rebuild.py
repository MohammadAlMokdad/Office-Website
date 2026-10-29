# Rebuild every simplified object from its original: collapse + smooth by angle (no transferred normals).
live_guard()
OVERRIDE = {"Ali_Keyboard_K380": 25000, "Laptop_Desk1": 45000, "Laptop_Desk2": 45000}
def go():
    out = []
    for o in mesh_objects():
        if not bpy.data.objects.get(o.name + "_HP"):
            continue
        t = OVERRIDE.get(o.name, int(o.get("web_target", 0)) or tris(o))
        a, b = simplify(o, t, "ANGLE"); out.append(f"{o.name} {a:,}->{b:,}")
    return out
log("rebuilt:", "; ".join(with_highpoly(go)))
log("scene triangles:", f"{sum(tris(o) for o in mesh_objects()):,}")
bpy.ops.wm.save_mainfile()
