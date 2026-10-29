# Scene edits asked for after the first web build (background, saves the bake file; Office.blend is not touched):
#   blender -b Office_bake.blend -P run.py -- s7_scene_edits.py
#  - Zuhair's mouse pad (Desk1_DeskMat) the same size and look as Mhmd's (Desk2_DeskMat), same place on its desk
#  - the bag on Mhmd's headset box removed
#  - Zuhair's mouse gets the same "Jedel" logo as Mhmd's
#  - Salah's "Be Happy" sticker on the desk directly under (in front of) his right, curved monitor
# Then: s4_uv.py for WindowDesks + IslandSalah, and a full re-bake of those atlases.
from mathutils import Matrix, Euler
if not bpy.app.background:
    live_guard()
done = []
desk_dy = bpy.data.objects["Desk_1_Top"].matrix_world.translation.y - bpy.data.objects["Desk_2_Top"].matrix_world.translation.y
shift = Matrix.Translation((0, desk_dy, 0))

# mouse pad: Zuhair's becomes a copy of Mhmd's, moved by the distance between the two (identical) desks
src, dst = bpy.data.objects["Desk2_DeskMat"], bpy.data.objects["Desk1_DeskMat"]
if dst.get("web_edit") != "deskmat":
    old = dst.data; dst.data = src.data.copy(); dst.data.name = "Desk1_DeskMat"
    if old.users == 0:
        bpy.data.meshes.remove(old)
    dst.matrix_world = shift @ src.matrix_world
    dst["web_edit"] = "deskmat"; done.append("Zuhair's mouse pad = Mhmd's")

# bag on the headset box: removed
bag = bpy.data.objects.get("MhmdDesk_Bag")
if bag:
    me = bag.data; bpy.data.objects.remove(bag, do_unlink=True)
    if me.users == 0:
        bpy.data.meshes.remove(me)
    done.append("bag removed")

# Jedel logo on Zuhair's mouse (both mice are the same model; Mhmd's carries the logo)
if not bpy.data.objects.get("ZouheirDesk_MouseLogo"):
    logo = bpy.data.objects["MhmdDesk_MouseLogo"]
    m1, m2 = bpy.data.objects["Mouse_Desk1"], bpy.data.objects["Mouse_Desk2"]
    rel = m2.matrix_world.inverted() @ logo.matrix_world          # logo relative to Mhmd's mouse
    c = logo.copy(); c.data = logo.data.copy(); c.name = "ZouheirDesk_MouseLogo"
    for col in logo.users_collection:
        col.objects.link(c)
    c.parent = None; c.matrix_world = m1.matrix_world @ rel
    done.append("Jedel logo on Zuhair's mouse")

# Be Happy sticker: flat on the desk, centred in front of the curved monitor's stand, facing Salah's seat
st = bpy.data.objects["SalahItem_BeHappySticker"]
if st.get("web_edit") != "moved":
    mon = bpy.data.objects["Salah_MonitorCurved"]; stand = bpy.data.objects["Salah_MonitorCurved_Stand"]
    kb = bpy.data.objects["Salah_Keyboard"]
    mc = wcenter(mon); kc = wcenter(kb)
    fwd = Vector((kc.x - mc.x, kc.y - mc.y, 0)).normalized()          # from the monitor towards where Salah sits
    pts = [stand.matrix_world @ Vector(p) for p in stand.bound_box]
    reach = max((Vector((p.x - mc.x, p.y - mc.y, 0))).dot(fwd) for p in pts)   # front edge of the stand's foot
    top = max((bpy.data.objects["DeskIsland_East_Top"].matrix_world @ Vector(p)).z for p in bpy.data.objects["DeskIsland_East_Top"].bound_box)
    loc = Vector((mc.x, mc.y, 0)) + fwd * (reach + 0.05)
    # keep its own tilt/size, turn it so its top edge points at the monitor (readable from the chair)
    yaw = math.atan2(-fwd.y, -fwd.x) - math.pi / 2
    s = st.matrix_world.to_scale()
    st.matrix_world = Matrix.LocRotScale(Vector((loc.x, loc.y, top + 0.0006)), Euler((0, 0, yaw)), s)
    st["web_edit"] = "moved"; done.append(f"sticker moved to ({loc.x:.3f}, {loc.y:.3f})")

log("scene edits:", done)
bpy.ops.wm.save_mainfile()
