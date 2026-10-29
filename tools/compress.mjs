// Step 7: Blender export (build/) -> web-ready files in the app.
//   node compress.mjs [--only geometry|textures] [--atlas Floor,Structure]
//   node compress.mjs --groups [--atlas ...]     only the light-group fraction maps (s5_groups.py), then the manifest
//   build/office.glb          -> app/public/models/office.glb   (meshopt: quantized + compressed geometry)
//   build/textures/*.png      -> app/public/models/textures/*.ktx2 (Basis Universal, mipmaps; GPU-compressed in VRAM)
//   build/textures/*_lamps.png, *_day.png -> textures/*_lamps.ktx2, *_day.ktx2 (linear data: how much of each texel's
//                                light each switchable light group gave), build/bake/groups.json -> manifest lightGroups
//   build/bake/env.exr        -> app/public/models/env.exr
//   build/scene.json, collision.json -> app/src/data/
//   three.js Basis transcoder -> app/public/basis/
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const run = promisify(execFile)
const BUILD = join(ROOT, 'build')
const APP = join(ROOT, 'app')
const MODELS = join(APP, 'public', 'models')
const TEX_OUT = join(MODELS, 'textures')
const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const ONLY = opt('--only')
const GROUPS = args.includes('--groups') // only the fraction maps: neither the geometry nor the other textures
const ATLAS_FILTER = new Set((opt('--atlas') ?? '').split(',').filter(Boolean))
for (const d of [MODELS, TEX_OUT, join(APP, 'src', 'data'), join(APP, 'public', 'basis')]) mkdirSync(d, { recursive: true })

// How each texture is compressed (ktx2-encoder 0.5.1: its Basis 1.x encoder takes 4096x4096; 0.6's Basis 2.5 build stops at 12 Mpix).
// download but blockier, fine for smooth data. RDO + Zstandard shrink UASTC downloads with little visible loss.
const UASTC = { isUASTC: true, uastcLDRQualityLevel: 1, enableRDO: true, rdoQualityLevel: 2.0, needSupercompression: true }
const UASTC_SMALL = { isUASTC: true, uastcLDRQualityLevel: 1, enableRDO: true, rdoQualityLevel: 2.0, needSupercompression: true }
const ETC1S = { isUASTC: false, qualityLevel: 255, compressionLevel: 2 }
// the fraction maps hold linear data: no sRGB transfer function, errors not weighed the way the eye sees colours
const UASTC_LINEAR = { ...UASTC, isSetKTX2SRGBTransferFunc: false, isPerceptual: false }
const ETC1S_LINEAR = { ...ETC1S, isSetKTX2SRGBTransferFunc: false, isPerceptual: false }
const MODES = JSON.parse(readFileSync(join(HERE, 'texture-modes.json'), 'utf8'))
const fallback = (name) => (name.endsWith('_lamps') || name.endsWith('_day') ? 'UASTC_LINEAR' : MODES.default)
const mode = (name) => ({ UASTC, UASTC_SMALL, ETC1S, UASTC_LINEAR, ETC1S_LINEAR })[MODES[name] ?? fallback(name)]

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`

async function geometry() {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const src = join(BUILD, 'office.glb')
  const doc = await io.read(src)
  await doc.transform(
    dedup(),
    weld(),
    // keep every attribute: the app assigns the atlases itself, so no glTF material references BakeUV or the cable colours
    prune({ keepAttributes: true }),
    // 16-bit UVs: 4096-texel atlases with 2-texel gaps need sub-texel precision
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 10, quantizeColor: 8 }),
  )
  const out = join(MODELS, 'office.glb')
  await io.write(out, doc)
  const meshes = doc.getRoot().listMeshes().length
  console.log(`geometry: ${mb(statSync(src).size)} -> ${mb(statSync(out).size)} (${meshes} meshes)`)
}

const PARALLEL = 4
const running = new Set()
async function encode(png, name, settings) {
  // each texture in its own process (see encode_one.mjs), a few at a time
  while (running.size >= PARALLEL) await Promise.race(running)
  const job = (async () => {
    const t = Date.now()
    const out = join(TEX_OUT, `${name}.ktx2`)
    const { stdout } = await run(process.execPath, [join(HERE, 'encode_one.mjs'), png, out, JSON.stringify(settings)], { maxBuffer: 1 << 26 })
    const size = Number(stdout.trim().split(/\s+/).pop())
    console.log(`  ${name.padEnd(22)} ${mb(statSync(png).size).padStart(9)} png -> ${mb(size).padStart(9)} ktx2  (${settings.isUASTC ? 'UASTC' : 'ETC1S'}, ${((Date.now() - t) / 1000).toFixed(0)}s)`)
  })()
  running.add(job)
  job.finally(() => running.delete(job))
  return `textures/${name}.ktx2`
}

async function textures(scene) {
  const files = {}
  for (const a of Object.keys(scene.atlases)) {
    if (ATLAS_FILTER.size && !ATLAS_FILTER.has(a)) continue
    files[a] = {
      color: await encode(join(BUILD, 'textures', `${a}.png`), a, mode(a)),
      spec: await encode(join(BUILD, 'textures', `${a}_spec.png`), `${a}_spec`, mode(`${a}_spec`)),
    }
  }
  if (!ATLAS_FILTER.size || ATLAS_FILTER.has('WindowView')) files.WindowView = await encode(join(BUILD, 'textures', 'WindowView.png'), 'WindowView', mode('WindowView'))
  await Promise.all(running)
  return files
}

// the light-group fraction maps (s5_groups.py), those that exist: UASTC, linear (ETC1S showed its blocks once a lamp was all the light)
async function groupTextures(scene) {
  for (const a of Object.keys(scene.atlases)) {
    if (ATLAS_FILTER.size && !ATLAS_FILTER.has(a)) continue
    for (const kind of ['lamps', 'day']) {
      const png = join(BUILD, 'textures', `${a}_${kind}.png`)
      if (existsSync(png)) await encode(png, `${a}_${kind}`, mode(`${a}_${kind}`))
      else console.warn(`no ${a}_${kind}.png yet (atlas ${a})`)
    }
  }
  await Promise.all(running)
}

// the fraction maps an atlas has, and the groups' tint / share from the bake, once they exist
const groupMaps = (a) => Object.fromEntries(['lamps', 'day'].filter((k) => existsSync(join(TEX_OUT, `${a}_${k}.ktx2`))).map((k) => [k, `textures/${a}_${k}.ktx2`]))
function lightGroups() {
  const path = join(BUILD, 'bake', 'groups.json')
  if (!existsSync(path)) return {}
  const { names, rest, encoding, tint, probe } = JSON.parse(readFileSync(path, 'utf8'))
  return { lightGroups: { names, rest, encoding, tint, probe } }
}

const scene = JSON.parse(readFileSync(join(BUILD, 'scene.json'), 'utf8'))
// reflection probes straight from the bake (so new probes need no re-export): Blender (x, y, z) -> three.js (x, z, -y)
function envManifest() {
  const env = JSON.parse(readFileSync(join(BUILD, 'bake', 'env.json'), 'utf8'))
  const three = ([x, y, z]) => [x, z, -y]
  const { min, max } = env.box_blender
  return {
    probes: Object.fromEntries(Object.entries(env.probes).map(([k, v]) => [k, { file: `env_${k}.exr`, center: three(v.center_blender) }])),
    atlasProbe: env.atlas_probe,
    meanLuminance: env.mean_luminance,
    boxMin: [min[0], min[2], -max[1]],
    boxMax: [max[0], max[2], -min[1]],
  }
}
if (GROUPS) await groupTextures(scene)
else {
  if (ONLY !== 'textures') await geometry()
  if (ONLY !== 'geometry') await textures(scene)
}

// manifest for the app: every atlas points at its .ktx2 files (whether encoded this run or before)
const manifest = {
  ...scene,
  model: 'office.glb',
  windowView: 'textures/WindowView.ktx2',
  atlases: Object.fromEntries(Object.entries(scene.atlases).map(([a, v]) => [a, { ...v, color: `textures/${a}.ktx2`, spec: `textures/${a}_spec.ktx2`, ...groupMaps(a) }])),
  env: envManifest(),
  ...lightGroups(),
}
for (const [a, v] of Object.entries(manifest.atlases)) {
  for (const f of [v.color, v.spec]) if (!existsSync(join(MODELS, f))) console.warn(`missing ${f} (atlas ${a})`)
}
writeFileSync(join(APP, 'src', 'data', 'scene.json'), JSON.stringify(manifest, null, 1))
copyFileSync(join(BUILD, 'collision.json'), join(APP, 'src', 'data', 'collision.json'))
for (const name of Object.keys(manifest.env.probes)) copyFileSync(join(BUILD, 'bake', `env_web_${name}.exr`), join(MODELS, `env_${name}.exr`))
const basis = join(APP, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis')
for (const f of readdirSync(basis)) if (!f.endsWith('.md')) copyFileSync(join(basis, f), join(APP, 'public', 'basis', f))

let total = 0
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : (total += statSync(p).size) } }
walk(MODELS)
console.log(`app/public/models: ${mb(total)} to download`)
