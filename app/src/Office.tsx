// The office as baked in Blender: one mesh and one draw call per atlas, a few separate pieces, glass, the cables
// (vertex colours), the screens (Screens.tsx) and the outside view. Nothing here is lit at runtime; nothing moves
// (the switches' rockers do, Lights.tsx). An atlas's fraction maps (which light lit each texel, once baked) go to its
// material so lights can be switched off (lighting.ts); each ceiling lamp is its own mesh with its own material, so
// its glow follows its switch.
import { useGLTF } from '@react-three/drei'
import { useLoader, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { bakedMaterial, type Env, glassMaterial, type GlassLook, type LightMaps, screenMaterial, setReflectGain } from './bakedMaterial'
import { scene as manifest } from './scene'
import { Screens } from './Screens'

const BASE = import.meta.env.BASE_URL
const MODEL = `${BASE}models/${manifest.model}`
const ATLASES = Object.keys(manifest.atlases)
// the atlases whose fraction maps are baked (both, or the shader does without)
const LIT = ATLASES.filter((a) => manifest.atlases[a].lamps && manifest.atlases[a].day)
const FRACTION_MAPS = LIT.flatMap((a) => [manifest.atlases[a].lamps!, manifest.atlases[a].day!]).map((f) => `${BASE}models/${f}`)
const TEXTURE_URLS = [
  ...ATLASES.flatMap((a) => [manifest.atlases[a].color, manifest.atlases[a].spec]),
  manifest.windowView,
].map((f) => `${BASE}models/${f}`).concat(FRACTION_MAPS)
const LAMP_MESH = /^lamp_[1-4]$/ // the ceiling lamps (web_lib.LAMPS), each its own mesh
const Q = new URLSearchParams(window.location.search)

let ktx2: KTX2Loader | null = null
function useKTX2Textures(urls: string[]) {
  const gl = useThree((s) => s.gl)
  return useLoader(KTX2Loader, urls, (loader) => {
    if (!ktx2) ktx2 = loader
    loader.setTranscoderPath(`${BASE}basis/`).detectSupport(gl)
  })
}

const PROBES = Object.keys(manifest.env.probes)

/** One prefiltered (PMREM) panorama per reflection probe: the middle of the room and each furniture area. */
function useReflectionProbes(): Record<string, Env> {
  const gl = useThree((s) => s.gl)
  const exrs = useLoader(EXRLoader, PROBES.map((p) => `${BASE}models/${manifest.env.probes[p].file}`))
  return useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const boxMin = new THREE.Vector3(...manifest.env.boxMin), boxMax = new THREE.Vector3(...manifest.env.boxMax)
    const out: Record<string, Env> = {}
    PROBES.forEach((p, i) => {
      const exr = exrs[i]
      exr.mapping = THREE.EquirectangularReflectionMapping
      exr.colorSpace = THREE.LinearSRGBColorSpace
      out[p] = { map: pmrem.fromEquirectangular(exr).texture, center: new THREE.Vector3(...manifest.env.probes[p].center), boxMin, boxMax, exposure: manifest.exposure }
      exr.dispose()
    })
    pmrem.dispose()
    return out
  }, [exrs, gl])
}

export function Office() {
  const { scene } = useGLTF(MODEL, false, true)
  const textures = useKTX2Textures(TEXTURE_URLS)
  const probes = useReflectionProbes()
  const gl = useThree((s) => s.gl)
  const [screens, setScreens] = useState<THREE.Mesh[]>([])

  const materials = useMemo(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
    const tex: Record<string, THREE.Texture> = {}
    TEXTURE_URLS.forEach((u, i) => {
      const t = textures[i]
      t.anisotropy = aniso
      t.flipY = false
      if (FRACTION_MAPS.includes(u)) t.colorSpace = THREE.NoColorSpace // data, not colour: no sRGB decoding
      tex[u] = t
    })
    const url = (f: string) => `${BASE}models/${f}`
    const out = new Map<string, THREE.Material>()
    const center = probes.center
    for (const a of ATLASES) {
      const color = tex[url(manifest.atlases[a].color)], spec = tex[url(manifest.atlases[a].spec)]
      const env = probes[manifest.env.atlasProbe[a] ?? 'center'] ?? center
      const light: LightMaps | undefined = LIT.includes(a) ? { lamps: tex[url(manifest.atlases[a].lamps!)], day: tex[url(manifest.atlases[a].day!)] } : undefined
      if (a === 'Alpha') {
        out.set('alpha_cutout', bakedMaterial('alpha_cutout', color, spec, env, 'cutout', light))
        out.set('alpha_blend', bakedMaterial('alpha_blend', color, spec, env, 'blend', light))
      } else {
        out.set(`atlas_${a}`, bakedMaterial(`atlas_${a}`, color, spec, env, 'opaque', light))
      }
      // the lamps' own materials (the Lighting atlas): lamp n's glow follows lamp n's switch
      if (a === 'Lighting') for (let n = 1; n <= 4; n++) out.set(`lamp_${n}`, bakedMaterial(`lamp_${n}`, color, spec, env, 'opaque', light && { ...light, selfLamp: n - 1 }))
    }
    const ambient = manifest.env.meanLuminance
    for (const [name, look] of Object.entries(manifest.glass)) out.set(`glass_${name}`, glassMaterial(`glass_${name}`, look as GlassLook, center, ambient))
    out.set('cables', new THREE.MeshBasicMaterial({ name: 'cables', vertexColors: true }))
    const view = tex[url(manifest.windowView)]
    out.set('window_view', new THREE.MeshBasicMaterial({ name: 'window_view', map: view, side: THREE.DoubleSide }))
    return out
  }, [textures, probes, gl])

  useLayoutEffect(() => {
    const missing = new Set<string>()
    const found: THREE.Mesh[] = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).userData.screen) found.push(mesh) // (effect re-run)
      else if (mesh.isMesh) {
        const src = mesh.material as THREE.Material
        const m = (LAMP_MESH.test(mesh.name) && materials.get(mesh.name)) || materials.get(src.name)
        if (m && mesh.name.startsWith('screen_')) {
          // a screen: its own material (content, power) over the atlas's baked glass; screen UVs from TEXCOORD_1
          mesh.material = screenMaterial(m as THREE.ShaderMaterial)
          mesh.geometry.setAttribute('screenUv', mesh.geometry.getAttribute('uv1'))
          found.push(mesh)
          src.dispose()
        } else if (m) {
          mesh.material = m
          src.dispose()
        } else missing.add(src.name)
        // transparent things draw after the room, glass last
        mesh.renderOrder = src.name.startsWith('glass_') ? 2 : src.name === 'alpha_blend' ? 1 : 0
      }
      o.updateMatrix()
      o.matrixAutoUpdate = false // the room never moves: no per-frame matrix work
    })
    // ?only=a,b: debugging, show only meshes whose name contains one of these
    const only = Q.get('only')?.split(',')
    if (only) scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.visible = only.some((k) => o.name.includes(k)) })
    scene.updateMatrixWorld(true)
    if (missing.size) console.warn('materials without a baked version:', [...missing])
    const gain = Number(Q.get('reflect') ?? 1)
    setReflectGain([...materials.values(), ...found.map((m) => m.material as THREE.Material)], gain)
    setScreens(found)
  }, [scene, materials])

  return (
    <>
      <primitive object={scene} />
      {screens.length > 0 && <Screens meshes={screens} />}
    </>
  )
}

useGLTF.preload(MODEL, false, true)
