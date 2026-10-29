# Step 3 (live): Cycles + the calibrated daylight preset (matches the EEVEE look within ~0.3 stops, see build/renders/cmp_p2.png)
live_guard()
PRESET = {"day": 4.0, "spot": 6.0, "sky": 4.0, "exp": 2.0}
apply_light_preset(PRESET)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "GPU"
sc.cycles.samples = 1024; sc.cycles.use_adaptive_sampling = True; sc.cycles.use_denoising = True
sc["web_light_preset"] = json.dumps(PRESET)
n = bpy.data.materials["WindowView_Emission"].node_tree.nodes["DayBoost_Strength"]
log("relit:", PRESET, "window light", round(n.inputs[1].default_value + n.inputs[2].default_value, 3),
    "camera sees window at", n.inputs[2].default_value, "exposure", sc.view_settings.exposure)
bpy.ops.wm.save_mainfile()
