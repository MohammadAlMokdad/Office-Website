// The four ceiling lamps and their wall switches by the brown door (scene.json lamps / switches, from the Blender
// export). Walk up to the switches and turn to them: the rocker nearest the middle of the view gets its label (LIGHT n,
// press E: the label says what E will do, as the intercom's does); E flicks that rocker about its hinge and switches
// its lamp: lighting.ts weights the lamp's share of the baked light (bakedMaterial.ts), the lamp's own glow included.
// A real LED goes dark almost at once. Keys only, no other UI.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { addUsable } from './interact'
import { lighting } from './lighting'
import { type LightGroup, scene as manifest } from './scene'
import { sfx } from './sfx'

const REACH = 1.7 // m (plan) from you to a switch: its label shows
const LIFT = 0.04 // m above the rocker's middle: where the label floats
const FLICK = 0.08 // s: the rocker's travel
const FADE = 0.15 // s: the lamp going dark, or lighting up
const LOOK_AGAIN = 30 // frames between looks for a rocker mesh that was not there yet

type Rocker = {
  name: string; lamp: LightGroup; n: number
  center: THREE.Vector3; axis: THREE.Vector3; normal: THREE.Vector3
  onAngle: number; offAngle: number // degrees about the hinge, as the export counts them
  on: boolean
  angle: number // the rocker's tilt now
  // the mesh, the pose it was exported in and that pose's tilt (the export says which state it shows: userData.on)
  mesh: THREE.Mesh | null; original: THREE.Matrix4; rest: number
}

declare global {
  interface Window { __lights?: { toggle: (n: number) => void; state: () => { name: string; lamp: string; on: boolean; angle: number; weight: number; mesh: boolean }[] } }
}

const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), IDENTITY = new THREE.Matrix4()

/** The rocker's matrix for its tilt: the exported pose turned about the hinge (axis through center, world) by the
 *  difference from the exported tilt; in the parent's space, as `matrix` is. matrixAutoUpdate stays off. */
function pose(r: Rocker) {
  const mesh = r.mesh
  if (!mesh) return
  const rad = THREE.MathUtils.degToRad(r.angle - r.rest)
  const parent = mesh.parent?.matrixWorld ?? IDENTITY
  const c = r.center
  mesh.matrix.copy(r.original).premultiply(parent)
    .premultiply(M.makeTranslation(-c.x, -c.y, -c.z)).premultiply(M2.makeRotationAxis(r.axis, rad)).premultiply(M.makeTranslation(c.x, c.y, c.z))
    .premultiply(M3.copy(parent).invert())
  mesh.updateMatrixWorld(true)
}

export function Lights() {
  const scene = useThree((s) => s.scene)
  const rockers = useMemo(() => Object.entries(manifest.switches ?? {}).flatMap(([name, s]): Rocker[] => {
    const n = Number(/^lamp_(\d)$/.exec(s.controls)?.[1])
    if (!n) return []
    return [{
      name, lamp: s.controls as LightGroup, n,
      center: new THREE.Vector3(...s.center), axis: new THREE.Vector3(...s.axis).normalize(), normal: new THREE.Vector3(...s.normal),
      onAngle: s.onAngle, offAngle: s.offAngle, on: true, angle: s.onAngle,
      mesh: null, original: new THREE.Matrix4(), rest: s.onAngle,
    }]
  }).sort((a, b) => a.n - b.n), [])

  // the rocker meshes (glTF nodes under Office's primitive; the room's matrices are frozen: Office.tsx)
  const attach = (r: Rocker) => {
    const mesh = scene.getObjectByName(r.name) as THREE.Mesh | undefined
    if (!mesh?.isMesh) return false
    r.mesh = mesh
    r.original.compose(mesh.position, mesh.quaternion, mesh.scale) // the exported pose (position etc. are never changed)
    r.rest = mesh.userData.on === false ? r.offAngle : r.onAngle
    pose(r)
    return true
  }

  useEffect(() => {
    rockers.forEach(attach)
    const toggle = (r: Rocker) => { sfx.play('switch', { at: r.center }); r.on = !r.on }
    const removers = rockers.map((r) => addUsable({
      at: r.center, facing: r.normal, reach: REACH, lift: LIFT, icon: 'bulb',
      label: () => (r.on ? `Light ${r.n} off` : `Light ${r.n}`),
      use: () => toggle(r),
    }))
    if (new URLSearchParams(window.location.search).has('debug')) { // tests
      window.__lights = {
        toggle: (n) => { const r = rockers.find((x) => x.n === n); if (r) toggle(r) },
        state: () => rockers.map((r) => ({ name: r.name, lamp: r.lamp, on: r.on, angle: r.angle, weight: lighting.get(r.lamp), mesh: !!r.mesh })),
      }
    }
    return () => {
      removers.forEach((f) => f())
      delete window.__lights
      for (const r of rockers) { // everything on and the rockers as exported
        r.on = true; r.angle = r.onAngle; pose(r)
        lighting.set(r.lamp, 1)
        r.mesh = null
      }
    }
  }, [rockers, scene]) // eslint-disable-line react-hooks/exhaustive-deps

  let frames = 0
  useFrame((_, dt) => {
    if (++frames % LOOK_AGAIN === 0) for (const r of rockers) if (!r.mesh) attach(r)
    for (const r of rockers) {
      // the rocker flicks over
      const tilt = r.on ? r.onAngle : r.offAngle
      if (r.angle !== tilt) {
        const step = (Math.abs(r.offAngle - r.onAngle) * dt) / FLICK
        r.angle += Math.sign(tilt - r.angle) * Math.min(Math.abs(tilt - r.angle), step)
        pose(r)
      }
      // the lamp fades, fast
      const w = lighting.get(r.lamp), target = r.on ? 1 : 0
      if (w !== target) lighting.set(r.lamp, w + Math.sign(target - w) * Math.min(Math.abs(target - w), dt / FADE))
    }
  })
  return null
}
