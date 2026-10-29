# Step 2c: flip the inside-out pieces found by s2_facing.py (build/flip.json).
#   live:        python bl.py s2_apply_flips.py 1800 --lib      (saves the bake file)
#   background:  blender -b ... -P run.py -- s2_apply_flips.py   (test only, nothing saved)
if not bpy.app.background:
    live_guard()
flips = json.load(open(os.path.join(BUILD, "flip.json")))
if bpy.context.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
done = []
for name, idx in flips.items():
    o = bpy.data.objects[name]
    flip_faces(o, idx)
    o["web_flipped"] = len(idx); done.append(name)
log(f"flipped inside-out pieces on {len(done)} objects; re-bake: {sorted({group_of(bpy.data.objects[n]) for n in done})}")
if not bpy.app.background:
    bpy.ops.wm.save_mainfile()
