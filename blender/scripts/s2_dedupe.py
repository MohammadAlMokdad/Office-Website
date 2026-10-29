# Repair (live): appending meshes from a backup also appended copies of their materials and images (".001" names),
# which hid glass / alpha materials from the pipeline (it knows them by name). Every datablock that is not in the
# untouched Office.blend is matched by content to its original and remapped onto it.
#   python bl.py s2_dedupe.py 600 --lib       (needs build/original_names.json, written from Office.blend)
import re
live_guard()
orig = json.load(open(os.path.join(BUILD, "original_names.json")))
stem = lambda n: re.sub(r"(\.\d{3})+$", "", n)


def image_sig(im):
    px = np.empty(min(4096, len(im.pixels)), np.float32)
    try:
        im.pixels.foreach_get(np.empty(len(im.pixels), np.float32))
        a = np.empty(len(im.pixels), np.float32); im.pixels.foreach_get(a); px = a[::max(1, len(a) // 4096)][:4096]
    except Exception:
        pass
    return (tuple(im.size), round(float(px.sum()), 3))


def mat_sig(m):
    if not m.node_tree:
        return ("nonodes",)
    out = []
    for n in m.node_tree.nodes:
        vals = []
        for i in n.inputs:
            if i.is_linked or not hasattr(i, "default_value"):
                continue
            v = i.default_value
            vals.append(tuple(round(float(x), 4) for x in v) if hasattr(v, "__len__") else round(float(v), 4) if isinstance(v, (int, float)) else str(v))
        out.append((n.bl_idname, getattr(n, "image", None) and n.image.name, str(vals)))
    return tuple(sorted(out))


def dedupe(coll, known, sig):
    dups = [d for d in coll if d.name not in known]
    mapping = {}
    for d in dups:
        cands = [coll[n] for n in known if stem(n) == stem(d.name) and n in coll]
        if not cands:
            continue
        s = sig(d)
        match = next((c for c in cands if sig(c) == s), None)
        if match is None:
            log(f"  no exact match for {d.name} among {[c.name for c in cands]}: left alone")
            continue
        mapping[d.name] = match.name
    for dn, on in mapping.items():
        coll[dn].user_remap(coll[on])
        coll.remove(coll[dn])
    return mapping


m_img = dedupe(bpy.data.images, set(orig["images"]), image_sig)
m_ng = dedupe(bpy.data.node_groups, set(orig["node_groups"]), lambda g: (len(g.nodes),))
m_mat = dedupe(bpy.data.materials, set(orig["materials"]), mat_sig)
log(f"dedupe: {len(m_img)} images, {len(m_ng)} node groups, {len(m_mat)} materials remapped onto their originals")
left = [m.name for m in bpy.data.materials if m.name not in set(orig["materials"])]
log(f"  materials still not in Office.blend: {left}")
bpy.ops.wm.save_mainfile()
