import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(process.argv[2])
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (/cables|Floor|IslandAli/.test(p.getMaterial()?.getName() ?? '')) console.log(m.getName(), p.listSemantics().join(','), p.getMaterial()?.getName(), p.getAttribute('TEXCOORD_0')?.getComponentType(), p.getAttribute('TEXCOORD_0')?.getNormalized())
