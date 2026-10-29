# Step 5d (background): build/bake/env_<probe>.exr -> env_web_<probe>.exr, half float + DWAA (lossy, ~1/6 the size).
#   blender -b --factory-startup -P run.py -- s5_env_web.py
meta = json.load(open(os.path.join(BAKE_DIR, "env.json")))
ds = bpy.data.scenes.new("web_env_save")
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); ds.collection.objects.link(cam); ds.camera = cam
ds.render.use_compositing = True; ds.render.use_sequencer = False
s = ds.render.image_settings; s.file_format = "OPEN_EXR"; s.color_depth = "16"; s.color_mode = "RGB"; s.exr_codec = "DWAA"
ds.view_settings.view_transform = "Standard"                 # EXR stays scene-linear either way
for name, p in meta["probes"].items():
    src = os.path.join(BAKE_DIR, p["file"]); dst = os.path.join(BAKE_DIR, f"env_web_{name}.exr")
    img = bpy.data.images.load(src); w, h = img.size
    ng = bpy.data.node_groups.new("web_env_save", "CompositorNodeTree"); ds.compositing_node_group = ng
    ni = ng.nodes.new("CompositorNodeImage"); ni.image = img
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor"); no = ng.nodes.new("NodeGroupOutput")
    ng.links.new(ni.outputs[0], no.inputs[0])
    ds.render.resolution_x, ds.render.resolution_y, ds.render.resolution_percentage = w, h, 100
    ds.render.filepath = dst
    bpy.ops.render.render(write_still=True, scene=ds.name)
    bpy.data.node_groups.remove(ng); bpy.data.images.remove(img)
    log(f"env_web_{name}.exr: {os.path.getsize(src) / 1e6:.1f} MB -> {os.path.getsize(dst) / 1e6:.1f} MB")
