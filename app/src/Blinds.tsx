// The windows' roller blinds and their two remotes on the drawer unit by Salah's desk. Each window has two blinds
// rolled up under the ceiling (baked in the model): a blackout one on the room side and a sheer one nearer the glass.
// The app hangs a sheet of fabric from each roller and unrolls it (the top edge stays at the roller, the bottom bar
// travels; a motor whirs at each window while it moves). The red remote's key, 1, rolls the blackout blinds of all three windows down or
// up, the blue remote's, 2, the sheer ones: both work within reach of the remotes, where their tags show (ui.ts), as the
// TV's remotes do (TV.tsx). The daylight through each window follows its sheets every frame (lighting.ts): the sky's
// light through a blackout sheet is 3 %, through a sheer one 50 %, and any sheet over a window takes the sun patch
// away (a sheer one spreads the sun's light: that share goes to the sky's). The blackout sheet is lit by the room, so
// it darkens with it.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { inspect } from './inspect'
import { setShortcuts, type Shortcut } from './interact'
import { GROUPS, lighting, SUN, WINDOWS } from './lighting'
import { type LightGroup, scene as manifest } from './scene'
import { callout, click } from './ui'
import { motor, sfx } from './sfx'

const BASE = import.meta.env.BASE_URL
const TRAVEL = 3.5 // s: a motorised blind's full drop
const HANDY = 1.3 // m from the remotes (plan): 1 and 2 work there
const LABELS = 2.6 // m from the remotes (plan): their tags show
const GAP = 0.005 // m: the sheet starts just under the roller
const TILE = 0.85 // m: the fabric texture repeats every this much (2-3 times across a window)

const KINDS = ['dark', 'light'] as const
type Kind = (typeof KINDS)[number]
// each kind of sheet: how much of the view it hides (its opacity), how much of the sky's light comes through it, the
// colour over its texture (the blackout sheet is tuned to the shade of its baked roll, in the room's light; the sheer
// one is a grey weave with the daylight through it), its texture, the remote and its key
const SHEET: Record<Kind, { view: number; sky: number; color: THREE.Color; file: string; remote: string; key: string; code: string; numpad: string; what: string; name: string }> = {
  dark: { view: 1, sky: 0.03, color: new THREE.Color(0.58, 0.58, 0.58), file: 'blind_dark.png', remote: 'blindRemoteRed', key: '1', code: 'Digit1', numpad: 'Numpad1', what: 'Blackout blinds', name: 'blackout blinds' },
  light: { view: 0.5, sky: 0.5, color: new THREE.Color(0.42, 0.44, 0.49), file: 'blind_light.png', remote: 'blindRemoteBlue', key: '2', code: 'Digit2', numpad: 'Numpad2', what: 'Sheer blinds', name: 'sheer blinds' },
}
// a closed sheet spreads the sun's light over the room instead of its patch: the sky's light through it grows by the
// sun's share of the daylight (scene.json lightGroups.probe), so the room keeps the same light
const probe = manifest.lightGroups?.probe ?? {}
const SKY_ALL = WINDOWS.reduce((s, g) => s + (probe[g] ?? 0), 0)
const SUN_SPREAD = SKY_ALL > 0 ? 1 + (probe[SUN] ?? 0) / SKY_ALL : 1
const skyThrough = (kind: Kind) => Math.min(1, SHEET[kind].sky * SUN_SPREAD)
// a little eased in and out: half linear, half smoothstep (a motor that ramps up and settles)
const ease = (u: number) => 0.5 * u + 0.5 * u * u * (3 - 2 * u)

type Move = { from: number; to: number; t: number; time: number }
type KindState = { down: boolean; f: number; move: Move | null; motors: Motor[] } // f: how far down, 0 (up) .. 1; the motors run while it moves
type Sheet = { kind: Kind; mesh: THREE.Mesh; top: THREE.Vector3; along: THREE.Vector3; width: number; drop: number; f: number }
type Motor = { stop: () => void }

/** The fabric texture of a sheet: tiled (TILE), sRGB, sharp at an angle. The material shows its plain colour until
 *  the image is there (or if it is missing). */
function fabric(file: string, material: THREE.MeshBasicMaterial, aniso: number) {
  const tex = new THREE.TextureLoader().load(`${BASE}media/${file}`, () => { material.map = tex; material.needsUpdate = true }, undefined, () => console.warn(`blinds: no texture ${file}`))
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = aniso
  return tex
}

/** A sheet's four corners for a drop of h: the top edge stays under the roller, the bottom edge travels; the fabric's
 *  pattern is pinned to the bottom bar (it comes off the roller as it unrolls), so the UVs count up from the bottom. */
function hang(geometry: THREE.BufferGeometry, top: THREE.Vector3, along: THREE.Vector3, width: number, h: number) {
  const p = geometry.getAttribute('position') as THREE.BufferAttribute, uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const hw = width / 2, u = width / TILE, v = h / TILE
  for (let i = 0; i < 4; i++) {
    const s = i % 2 ? hw : -hw, y = i < 2 ? 0 : -h
    p.setXYZ(i, top.x + along.x * s, top.y - GAP + y, top.z + along.z * s)
    uv.setXY(i, i % 2 ? u : 0, i < 2 ? v : 0)
  }
  p.needsUpdate = uv.needsUpdate = true
}

export function Blinds() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)

  const b = useMemo(() => {
    const remoteAt = (key: string) => {
      const p = manifest.props?.[key]
      return p ? new THREE.Vector3(p.center[0], p.box[1][1], p.center[2]) : null // on top of the remote
    }
    const remotes = KINDS.map((k) => remoteAt(SHEET[k].remote)).filter((v): v is THREE.Vector3 => !!v)
    const kinds = { dark: { down: false, f: 0, move: null, motors: [] }, light: { down: false, f: 0, move: null, motors: [] } } as Record<Kind, KindState>
    // the windows whose daylight the sheets take away (only the light groups the shader knows)
    const windows = Object.keys(manifest.blinds ?? {}).map((w) => `win_${w}`).filter((g): g is LightGroup => (GROUPS as readonly string[]).includes(g))
    return {
      kinds, windows, sheets: [] as Sheet[], handy: false, keys: [] as Shortcut[], dark: null as THREE.MeshBasicMaterial | null,
      callouts: KINDS.map((k) => ({ el: callout(SHEET[k].key, SHEET[k].what), at: remoteAt(SHEET[k].remote), on: false })),
      // where the keys work and the tags show: between the two remotes (they lie side by side on the drawer unit)
      remotes: remotes.length ? remotes.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(remotes.length) : null,
    }
  }, [])

  useEffect(() => {
    // a press: the blinds of this kind go the other way (down if they are up or going up), from wherever they are
    const toggle = (kind: Kind) => {
      const s = b.kinds[kind]
      s.down = !s.down
      const to = s.down ? 1 : 0
      s.move = { from: s.f, to, t: 0, time: Math.max(0.05, Math.abs(to - s.f) * TRAVEL) }
      if (!s.motors.length) s.motors = Object.values(manifest.blinds ?? {}).map((w) => motor(new THREE.Vector3(...w.glass.center))) // one at each window
    }
    // the sheets: a quad per blind, hanging from its roller, drawn once it starts to unroll. They are drawn after the
    // opaque room and before its see-through things (the mesh of a chair in front of a window, renderOrder 1) and the
    // glass (2), the sheer one first (it hangs nearer the glass), and they write depth: so the window's glass behind a
    // sheet does not paint its reflection of the room over the fabric, while glass and chairs in front of it still
    // draw over it (nothing of the room is behind a window).
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
    const textures: THREE.Texture[] = [], materials: THREE.Material[] = []
    for (const kind of KINDS) {
      const look = SHEET[kind]
      const material = new THREE.MeshBasicMaterial({
        name: `blind_${kind}`, color: look.color, transparent: true, opacity: look.view, depthWrite: true, side: THREE.DoubleSide, toneMapped: false,
      })
      textures.push(fabric(look.file, material, aniso)); materials.push(material)
      if (kind === 'dark') b.dark = material
      for (const [name, w] of Object.entries(manifest.blinds ?? {})) {
        const blind = w[kind]
        const top = new THREE.Vector3(...blind.top), along = new THREE.Vector3(...w.along).normalize()
        const drop = top.y - GAP - w.bottom
        if (!(drop > 0) || !(blind.width > 0)) continue
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2))
        geometry.setIndex([0, 2, 1, 1, 2, 3])
        hang(geometry, top, along, blind.width, drop) // fully down once: its bounds (culling) cover every drop
        geometry.computeBoundingSphere()
        hang(geometry, top, along, blind.width, 0)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `blind_${name}_${kind}`
        mesh.renderOrder = kind === 'light' ? 0.5 : 0.6
        mesh.visible = false
        mesh.matrixAutoUpdate = false
        scene.add(mesh)
        b.sheets.push({ kind, mesh, top, along, width: blind.width, drop, f: 0 })
      }
    }
    // the two remotes lie side by side: the red one's tag sits a row above the blue one's, so they never overlap
    b.callouts[0].el.style.marginTop = '-60px'
    b.callouts.forEach((c) => document.body.appendChild(c.el))
    b.keys = KINDS.map((k) => ({
      code: SHEET[k].code, key: SHEET[k].key,
      label: () => `${SHEET[k].name} ${b.kinds[k].down ? 'up' : 'down'}`, // what the key will do now
      use: () => { click(); toggle(k) },
    }))
    // the same keys on the number pad
    const numpad = (e: KeyboardEvent) => {
      if (e.repeat || !b.handy || !document.pointerLockElement) return
      const k = KINDS.find((k) => SHEET[k].numpad === e.code)
      if (k) { e.preventDefault(); click(); toggle(k) }
    }
    window.addEventListener('keydown', numpad)
    if (new URLSearchParams(location.search).has('debug')) {
      Object.assign(window, { // tests
        __blinds: {
          set: (kind: Kind, down: boolean) => { if (b.kinds[kind].down !== down) toggle(kind) },
          state: () => ({
            dark: { down: b.kinds.dark.down, fraction: b.kinds.dark.f, moving: !!b.kinds.dark.move },
            light: { down: b.kinds.light.down, fraction: b.kinds.light.f, moving: !!b.kinds.light.move },
            sheets: b.sheets.length, windows: Object.fromEntries(b.windows.map((g) => [g, lighting.get(g)])), sun: lighting.get(SUN), room: lighting.light(),
          }),
        },
      })
    }
    return () => {
      window.removeEventListener('keydown', numpad)
      if (b.handy) { b.handy = false; setShortcuts([], 'blinds') }
      b.callouts.forEach((c) => { c.el.remove(); c.on = false; c.el.style.display = 'none' })
      for (const s of b.sheets) { scene.remove(s.mesh); s.mesh.geometry.dispose() }
      b.sheets.length = 0; b.dark = null
      for (const g of b.windows) lighting.set(g, 1)
      lighting.set(SUN, 1)
      for (const k of KINDS) { b.kinds[k].motors.forEach((h) => h.stop()); b.kinds[k].motors = [] }
      materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose())
    }
  }, [b, scene, gl])

  const p = useMemo(() => new THREE.Vector3(), [])
  // every frame (after Player moved the camera: mounted later): the blinds on their way, the sheets, the daylight
  // through each window, and the remotes' keys and tags
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    for (const k of KINDS) {
      const s = b.kinds[k], m = s.move
      if (!m) continue
      m.t += dt
      const u = Math.min(1, m.t / m.time)
      s.f = m.from + (m.to - m.from) * ease(u)
      if (u >= 1) {
        s.f = m.to; s.move = null; s.motors.forEach((h) => h.stop()); s.motors = []
        for (const w of Object.values(manifest.blinds ?? {})) sfx.play('clunk', { at: new THREE.Vector3(...w.glass.center), volume: 0.7 }) // the end stop, at each window
      }
    }
    for (const sh of b.sheets) {
      const f = b.kinds[sh.kind].f
      if (f === sh.f) continue
      sh.f = f
      hang(sh.mesh.geometry, sh.top, sh.along, sh.width, f * sh.drop)
      sh.mesh.visible = f > 0.0005
    }
    // the sky's light through the sheets (a sheet part way down covers that part of the window); the sun patch stays
    // only where no sheet is over the window
    const dark = b.kinds.dark.f, light = b.kinds.light.f
    const sky = (1 - (1 - skyThrough('dark')) * dark) * (1 - (1 - skyThrough('light')) * light)
    for (const g of b.windows) lighting.set(g, sky)
    lighting.set(SUN, (1 - dark) * (1 - light))
    // the blackout sheet is lit by the room: as bright as the room is now
    if (b.dark) b.dark.color.copy(SHEET.dark.color).multiplyScalar(Math.min(1, Math.max(0.03, lighting.light())))

    if (!b.remotes) return
    const locked = !!document.pointerLockElement && !inspect.name()
    const near = Math.hypot(camera.position.x - b.remotes.x, camera.position.z - b.remotes.z)
    const handy = locked && near < HANDY
    if (handy !== b.handy) { b.handy = handy; setShortcuts(handy ? b.keys : [], 'blinds') }
    for (const c of b.callouts) {
      let on = locked && near < LABELS && !!c.at
      if (on) {
        p.copy(c.at!).project(camera)
        on = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05
        if (on) c.el.style.transform = `translate(${((p.x + 1) / 2) * state.size.width}px, ${((1 - p.y) / 2) * state.size.height}px)`
      }
      if (on !== c.on) { c.on = on; c.el.style.display = on ? '' : 'none' }
    }
  })
  return null
}
