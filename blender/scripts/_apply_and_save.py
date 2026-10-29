exec(open(os.path.join(os.path.dirname(__file__), "s2_apply_flips.py"), encoding="utf-8").read())
bpy.ops.wm.save_mainfile()
log("flips applied and saved")
