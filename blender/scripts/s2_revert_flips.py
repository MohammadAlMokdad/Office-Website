# Undo s2_fix_normals.py: the flipped objects get their meshes back from Office_bake.blend1 (saved just before).
live_guard()
blend1 = BAKE_FILE + "1"
objs = [o for o in mesh_objects() if o.get("web_flipped")]
names = [o.data.name for o in objs]
with bpy.data.libraries.load(blend1, link=False) as (src, dst):
    dst.meshes = [n for n in names if n in src.meshes]
loaded = {n: m for n, m in zip(names, dst.meshes)}
for o in objs:
    old = o.data; new = loaded[old.name]
    o.data = new; bpy.data.meshes.remove(old); new.name = new.name.split(".")[0] if False else new.name
    del o["web_flipped"]
log(f"reverted flips on {len(objs)} objects from {blend1}")
bpy.ops.wm.save_mainfile()
