// What the Blender build produced (written by tools/compress.mjs from build/scene.json).
import data from './data/scene.json'

export type V3 = [number, number, number]
export type Box = [V3, V3]
/** The light groups the app can switch, in the order of the fraction maps' channels (lighting.ts). */
export type LightGroup = 'lamp_1' | 'lamp_2' | 'lamp_3' | 'lamp_4' | 'win_South' | 'win_East' | 'win_Angled' | 'sun'

export type SceneManifest = {
  model: string
  windowView: string
  atlases: Record<string, {
    size: number; pxPerM: number; color: string; spec: string
    // how much of each texel's colour comes from each switchable light group (s5_groups.py), quarter size, stored as
    // square roots: lamps: R G B A = lamp_1 .. lamp_4 (a lamp's own glow in its channel); day: R G B = the sky's
    // daylight through the South, East, Angled windows, A = the sun. Missing until the groups are baked.
    lamps?: string; day?: string
  }>
  glass: Record<string, { color: V3; alpha: number; transmission: number; roughness: number; ior: number }>
  env: {
    probes: Record<string, { file: string; center: V3 }> // reflection panoramas
    atlasProbe: Record<string, string> // which probe each atlas reflects
    boxMin: V3 // the room, for box-projected reflections
    boxMax: V3
    meanLuminance: number
  }
  exposure: number // stops, as in Blender
  backdrop?: { sky: V3; ground: V3 } // display colours beyond the outside photo
  // screen meshes (content UVs in TEXCOORD_1): width / height, and the part of the UV square you can see
  screens?: Record<string, {
    aspect: number
    view?: [number, number, number, number]
    // the visible area as a flat frame: centre, axes and size in metres (HTML laid over a flat screen)
    frame?: { center: V3; right: V3; up: V3; normal: V3; size: [number, number] }
  }>
  props?: Record<string, { center: V3; box: Box }> // remotes etc. (three.js)
  // chairs you can sit on: seated eye, what you face, the chair's box (three.js coordinates)
  seats?: { name: string; label: string; eye: V3; look: V3; box: Box }[]
  // the ceiling lamps (one mesh each in office.glb, named like the key): where it hangs, which wall switch mesh controls it
  lamps?: Record<string, { center: V3; switch: string }>
  // the wall switches (separate meshes in office.glb, named like the key): which lamp, the rocker's middle and box,
  // its hinge (horizontal, along the wall) and the way out of the wall, and the rocker's tilt in degrees when on / off
  switches?: Record<string, { controls: string; center: V3; box: Box; axis: V3; normal: V3; onAngle: number; offAngle: number }>
  // the windows' roller blinds: the sheet unrolls from under each roller down to `bottom`, along `along`, facing
  // `outward` (from the room through the window); a window's glass as a flat frame, for the view through it
  blinds?: Record<string, {
    along: V3; outward: V3; bottom: number
    dark: { top: V3; width: number; roll: Box } // blackout blind: the middle of the roller's underside, the fabric's width
    light: { top: V3; width: number; roll: Box } // sheer blind
    glass: { center: V3; size: [number, number] }
  }>
  // the switchable light groups (s5_groups.py): for each (and `rest`, the light no switch takes away), its colour
  // relative to all light (per channel scale) and its share of all the light (the reflection panoramas' too)
  lightGroups?: { names: LightGroup[]; rest?: string; encoding?: 'sqrt'; tint: Record<string, V3>; probe: Record<string, number> }
  floor: number // Blender z of the floor = three.js y
  ceiling: number
  eye: number // standing eye height above the floor
}

export const scene = data as unknown as SceneManifest
