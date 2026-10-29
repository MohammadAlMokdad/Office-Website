import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(process.argv[2])
for (const m of doc.getRoot().listMeshes().slice(0, 6)) for (const p of m.listPrimitives()) console.log(m.getName(), p.listSemantics().join(','), p.getMaterial()?.getName())
