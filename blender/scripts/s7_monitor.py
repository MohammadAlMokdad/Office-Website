# Ali's curved monitor back to its full original mesh: the 15k-triangle version had sliver triangles and bent faces
# that baked as speckles along its edges and a dashed line across its back. Then: s4_uv + bake for IslandAli.
#   blender -b Office_bake.blend -P run.py -- s7_monitor.py
o = bpy.data.objects["Ali_Monitor"]
n0, n1 = with_highpoly(lambda: simplify(o, 100000, "ANGLE"))
log(f"Ali_Monitor: {n1} triangles (high-poly {n0})")
bpy.ops.wm.save_mainfile()
