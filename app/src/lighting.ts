// The lights you can switch: the four ceiling lamps (the wall switches, Lights.tsx) and the daylight through each window
// (the blinds, Blinds.tsx): the sky's light per window and the direct sun as a group of its own, so a closed blind
// takes the sun patch off the floor whole. The room is baked with everything on; for every switchable light group the
// bake also knows how much of each texel's colour it gave (fraction maps, scene.json atlases[].lamps / .day), so the
// shader can take that light away: baked colour -> inverse AgX -> scale -> AgX (bakedMaterial.ts). One weight per
// group, 1 = fully on.
// The lamps as baked are faint next to the daylight (about 7 % of the room's light: the bake is exposed for the day,
// as a camera in that room would be). With the blinds closed a camera, or your eyes, open up: here each lamp that is on
// then gives `gain` (7) x its baked light, and the whole picture is exposed up by (everything on / the light now)^adapt
// (0.5), at most adaptMax (2.5) x: a dark room stays dark, a lit one looks lit. With all the daylight on nothing of this applies
// and the picture is the bake, bit for bit.
// The weights live in shader uniforms shared by every material (the uniform *values* are mutated in place, so copies
// of the uniform objects, as screenMaterial makes, follow too).
import * as THREE from 'three'
import { type LightGroup, scene as manifest } from './scene'

export const GROUPS: readonly LightGroup[] = ['lamp_1', 'lamp_2', 'lamp_3', 'lamp_4', 'win_South', 'win_East', 'win_Angled', 'sun']
export const LAMPS = GROUPS.slice(0, 4) as LightGroup[]
export const WINDOWS = GROUPS.slice(4, 7) as LightGroup[]
export const SUN: LightGroup = 'sun'
export const DAYLIGHT = GROUPS.slice(4) as LightGroup[] // the windows' sky light and the sun

const weights: Record<LightGroup, number> = { lamp_1: 1, lamp_2: 1, lamp_3: 1, lamp_4: 1, win_South: 1, win_East: 1, win_Angled: 1, sun: 1 }
const probe = manifest.lightGroups?.probe ?? {}
const share = (g: string) => probe[g] ?? 0
const DAY_ALL = DAYLIGHT.reduce((s, g) => s + share(g), 0) // the daylight's share of all the light
const Q = new URLSearchParams(window.location.search)
const num = (k: string, d: number) => (Q.has(k) && Number.isFinite(Number(Q.get(k))) ? Number(Q.get(k)) : d)
// (?gain= ?adapt= ?adaptMax= try other values; tests set them through window.__lighting.tune)
const tune = { gain: num('gain', 7), adapt: num('adapt', 0.5), adaptMax: num('adaptMax', 2.5) }

/** Uniforms every baked / glass material shares (bakedMaterial.ts adds them to its uniform lists by reference). */
export const LIGHT_UNIFORMS = {
  lampW: { value: new THREE.Vector4(1, 1, 1, 1) }, // each lamp's light, x its baked light (its switch x the gain)
  dayW: { value: new THREE.Vector4(1, 1, 1, 1) }, // the sky's light through the South, East, Angled windows; the sun
  // x: how much of the panoramas' light is on (reflections, glass bodies), exposure included; y: 1 when the shader
  // must run the inverse-AgX path (any light not fully on); z: the exposure, x the light of every baked texel
  lightMisc: { value: new THREE.Vector4(1, 0, 1, 0) },
}

const listeners = new Set<() => void>()
let level = 1, exposure = 1, gain = 1
function apply() {
  const u = LIGHT_UNIFORMS
  // the daylight left (0 .. 1) sets the lamps' gain: a camera opening up as the room darkens
  const day = DAY_ALL > 0 ? DAYLIGHT.reduce((s, g) => s + weights[g] * share(g), 0) / DAY_ALL : 1
  gain = 1 + (tune.gain - 1) * (1 - Math.min(1, Math.max(0, day)))
  const lamp = (g: LightGroup) => weights[g] * gain
  // the light now, as a share of everything on (the lamps with their gain)
  level = 1
  for (const g of GROUPS) level -= (1 - (LAMPS.includes(g) ? lamp(g) : weights[g])) * share(g)
  level = Math.max(0.02, level)
  exposure = Math.min(tune.adaptMax, Math.max(1, level ** -tune.adapt))
  let mix = 0
  for (const g of GROUPS) if (weights[g] < 0.9999) mix = 1
  u.lampW.value.set(lamp('lamp_1'), lamp('lamp_2'), lamp('lamp_3'), lamp('lamp_4'))
  u.dayW.value.set(weights.win_South, weights.win_East, weights.win_Angled, weights.sun)
  u.lightMisc.value.set(level * exposure, mix, exposure, 0)
  listeners.forEach((f) => f())
}

export const lighting = {
  /** 0 (off / fully covered) .. 1 (on / open). */
  get: (g: LightGroup) => weights[g],
  set(g: LightGroup, w: number) {
    const v = Math.min(1, Math.max(0, w))
    if (v === weights[g]) return
    weights[g] = v
    apply()
  },
  /** How bright the room is now next to everything on: the light left (with the lamps' gain) x the exposure, 1 with
   *  everything on. Things lit by the room but not baked (the blinds' sheets) follow it. */
  light: () => level * exposure,
  /** For useSyncExternalStore (the overlay): any change of any weight. */
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } },
  snapshot: () => weights, // (mutated in place: compare weights, not the object)
  /** Tests and calibration: other gain / adaptation values, applied at once. */
  tune(t: Partial<typeof tune>) { Object.assign(tune, t); apply() },
  tuned: () => ({ ...tune, gain_now: gain, level, exposure }),
}
if (Q.has('debug')) Object.assign(window, { __lighting: lighting }) // tests
