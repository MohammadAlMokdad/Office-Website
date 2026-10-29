// First-person walker: pointer-lock mouse look, WASD / arrows, Shift to walk faster, a light head bob, and
// collision against the room walls and furniture footprints. Sitting (Seats.tsx): a short glide into the seat, facing
// the desk; you look around as you do walking, and Esc stands you up where you were. Chrome lets go of the mouse at Esc
// (and keeps the key to itself) and takes it again only at a key press or a click: until then you walk and look on
// without it ('loose'), with no pause menu. Looking closely (inspect.ts): the camera flies up to a screen and, after,
// back to exactly where you were, seated or standing.
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { PointerLockControls as PLC } from 'three-stdlib'
import * as THREE from 'three'
import { Collider } from './collision'
import { typing } from './htmlScreen'
import { pauseUsables, setSeated } from './interact'
import { sfx } from './sfx'

const WALK = 1.4, RUN = 2.6 // m/s
const STRIDE = 0.72 // m between footsteps walking (a little longer running)
/** Called by the overlay's Enter button (pointer lock must start inside that click). */
export const pointer = { lock: () => {} }
/** The mouse: locked (walking, seated), loose (just up from a seat by Esc) or free (the menu, a screen). */
export type Mouse = 'locked' | 'loose' | null
export type Seat = { eye: THREE.Vector3; look: THREE.Vector3 }
/** Called by Seats.tsx. */
export const seating = { sit: (_seat: Seat) => {}, stand: () => {}, seated: false }
/** A flat thing to look at closely (a screen's glass): its middle, the way it faces, width and height in metres. */
export type Frame = { center: THREE.Vector3; normal: THREE.Vector3; size: readonly [number, number] }
/** Called by inspect.ts: fly up to a frame (it fills most of the view), and back (`then`: once there). */
export const camRig = { frame: (_f: Frame) => {}, back: (_then?: () => void) => {} }
const GLIDE = 0.6, FLY = 0.8 // s: sitting down or standing up; flying to a screen or back
const FILL = 0.85 // of the view, by a frame flown to: the corner hints stay off it
/** How far in front of a frame the camera stops when it flies up to it. */
export function flyDistance(f: Frame, cam: THREE.PerspectiveCamera) {
  const t = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
  return Math.max(f.size[1] / FILL / 2 / t, f.size[0] / FILL / 2 / (t * cam.aspect))
}
type Glide = { from: THREE.Vector3; to: THREE.Vector3; yaw0: number; pitch0: number; yaw1: number; pitch1: number; t: number; time: number; then?: () => void }
type Pose = { pos: THREE.Vector3; yaw: number; pitch: number }
const look = new THREE.Euler(0, 0, 0, 'YXZ')
const TURN = 0.002 // rad per pixel of mouse, as PointerLockControls turns
const ASK = 400 // ms between asks for the mouse while loose (a key held down repeats)
const KEYS: Record<string, 'f' | 'b' | 'l' | 'r'> = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
}

export function Player({ onLockChange }: { onLockChange: (mouse: Mouse) => void }) {
  const camera = useThree((s) => s.camera)
  const collider = useMemo(() => new Collider(), [])
  const pos = useRef({ ...collider.spawn })
  const vel = useRef(new THREE.Vector2())
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false })
  const locked = useRef(false)
  const loose = useRef(false), stale = useRef(false) // stale: the next mouse move counts what it did locked too
  const bob = useRef(0)
  const controls = useRef<PLC>(null)
  useEffect(() => { pointer.lock = () => controls.current?.lock() }, [])

  const seated = useRef(false)
  const glide = useRef<Glide | null>(null)
  const inspecting = useRef(false)
  useEffect(() => {
    // to a place, facing a point there or turned to a yaw / pitch
    const start = (to: THREE.Vector3, facing?: THREE.Vector3 | { yaw: number; pitch: number }, time = GLIDE) => {
      look.setFromQuaternion(camera.quaternion, 'YXZ')
      const g = { from: camera.position.clone(), to, yaw0: look.y, pitch0: look.x, yaw1: look.y, pitch1: look.x, t: 0, time }
      if (facing instanceof THREE.Vector3) {
        const d = facing.clone().sub(to)
        g.yaw1 = Math.atan2(-d.x, -d.z); g.pitch1 = Math.atan2(d.y, Math.hypot(d.x, d.z))
      } else if (facing) { g.yaw1 = facing.yaw; g.pitch1 = facing.pitch }
      g.yaw1 = g.yaw0 + Math.atan2(Math.sin(g.yaw1 - g.yaw0), Math.cos(g.yaw1 - g.yaw0)) // the short way round
      glide.current = g
    }
    let saved: Pose | null = null // where you were before flying to a screen
    camRig.frame = (f) => {
      if (!saved) {
        const g = glide.current // (sitting down still: where that ends)
        look.setFromQuaternion(camera.quaternion, 'YXZ')
        saved = g ? { pos: g.to.clone(), yaw: g.yaw1, pitch: g.pitch1 } : { pos: camera.position.clone(), yaw: look.y, pitch: look.x }
      }
      inspecting.current = true
      vel.current.set(0, 0)
      start(f.center.clone().addScaledVector(f.normal, flyDistance(f, camera as THREE.PerspectiveCamera)), f.center, FLY)
    }
    camRig.back = (then) => {
      if (!saved) return
      start(saved.pos, saved, FLY)
      glide.current!.then = then
      saved = null; inspecting.current = false
    }
    seating.sit = (seat) => {
      if (seated.current) return
      seated.current = seating.seated = true
      vel.current.set(0, 0)
      start(seat.eye.clone(), seat.look)
      setSeated(true)
      sfx.play('cloth'); sfx.play('creak', { at: seat.eye, delay: GLIDE * 0.7, volume: 0.8 }) // down, and the chair takes you
    }
    seating.stand = () => {
      if (!seated.current || inspecting.current) return
      seated.current = seating.seated = false
      start(new THREE.Vector3(pos.current.x, collider.eye, -pos.current.y)) // back where you stood
      setSeated(false)
      sfx.play('creak', { at: camera.position, volume: 0.6 }); sfx.play('cloth', { delay: 0.15 })
    }
    return () => { seating.sit = () => {}; seating.stand = () => {}; camRig.frame = () => {}; camRig.back = () => {} }
  }, [camera, collider])

  // plan (x, y) -> three.js (x, height, -y); ?cam=x,y,lookx,looky[,lookz] overrides the start view (checks / screenshots)
  // ?view=x,y,z,tx,ty,tz,lens (Blender coordinates and lens in mm) freezes an exact camera, to compare with Blender renders
  const fixed = useRef(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const view = q.get('view')?.split(',').map(Number)
    if (view?.length === 7) {
      const cam = camera as THREE.PerspectiveCamera
      fixed.current = true
      cam.position.set(view[0], view[2], -view[1])
      cam.lookAt(view[3], view[5], -view[4])
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(18 / view[6] / cam.aspect)) // Blender's 36 mm sensor across the width
      cam.updateProjectionMatrix()
      return
    }
    const cam = q.get('cam')?.split(',').map(Number)
    if (cam && cam.length >= 4) { pos.current = { x: cam[0], y: cam[1] }; collider.look.x = cam[2]; collider.look.y = cam[3] }
    camera.position.set(pos.current.x, collider.eye, -pos.current.y)
    camera.lookAt(collider.look.x, cam?.[4] ?? collider.eye - 0.25, -collider.look.y)
  }, [camera, collider])

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      if (down && typing(e.target)) return // typing on a screen (a text box, the laptops' code editor)
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.run = down
      const k = KEYS[e.code]
      if (k) { keys.current[k] = down; e.preventDefault() }
    }
    const kd = (e: KeyboardEvent) => set(e, true), ku = (e: KeyboardEvent) => set(e, false)
    const blur = () => Object.assign(keys.current, { f: false, b: false, l: false, r: false, run: false })
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur) }
  }, [])

  // loose (see the top): the mouse turns you as it does locked, the keys walk you, and a key press or a click (the
  // overlay's) asks for the mouse again; Esc there, or another window, and it is the pause menu
  useEffect(() => {
    let asked = -Infinity
    const end = () => { if (loose.current) { loose.current = false; onLockChange(null) } }
    const turn = (e: MouseEvent) => {
      if (!loose.current || stale.current || glide.current) { stale.current = false; return }
      look.setFromQuaternion(camera.quaternion, 'YXZ')
      look.y -= e.movementX * TURN
      look.x = THREE.MathUtils.clamp(look.x - e.movementY * TURN, -Math.PI / 2, Math.PI / 2)
      camera.quaternion.setFromEuler(look)
    }
    const key = (e: KeyboardEvent) => {
      if (!loose.current) return
      if (e.code === 'Escape') end()
      else if (e.timeStamp - asked > ASK) { asked = e.timeStamp; pointer.lock() } // (Chrome says no until ~1 s after Esc)
    }
    document.addEventListener('mousemove', turn); window.addEventListener('keydown', key); window.addEventListener('blur', end)
    return () => { document.removeEventListener('mousemove', turn); window.removeEventListener('keydown', key); window.removeEventListener('blur', end) }
  }, [camera, onLockChange])

  const fwd = useMemo(() => new THREE.Vector3(), [])
  const stride = useRef(STRIDE * 0.6), foot = useRef(1) // m walked since the last footstep; which foot
  useFrame((_, rawDt) => {
    if (fixed.current) return
    const dt = Math.min(rawDt, 0.05)
    const k = keys.current
    const g = glide.current
    pauseUsables(!!g || inspecting.current) // no labels to use things while the camera is on its way or at a screen
    if (g) {
      g.t = Math.min(1, g.t + dt / g.time)
      const e = g.t * g.t * (3 - 2 * g.t)
      camera.position.lerpVectors(g.from, g.to, e)
      camera.quaternion.setFromEuler(look.set(g.pitch0 + (g.pitch1 - g.pitch0) * e, g.yaw0 + (g.yaw1 - g.yaw0) * e, 0, 'YXZ'))
      if (g.t >= 1) { glide.current = null; g.then?.() }
      return
    }
    if (inspecting.current || seated.current) return // the camera stays at the screen, in the seat
    camera.getWorldDirection(fwd)
    // plan-space forward / right from the camera yaw
    const fx = fwd.x, fy = -fwd.z, fl = Math.hypot(fx, fy) || 1
    const f = { x: fx / fl, y: fy / fl }, r = { x: f.y, y: -f.x }
    const ix = (k.f ? 1 : 0) - (k.b ? 1 : 0), iy = (k.r ? 1 : 0) - (k.l ? 1 : 0)
    const wish = new THREE.Vector2(f.x * ix + r.x * iy, f.y * ix + r.y * iy)
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(k.run ? RUN : WALK)
    if (!locked.current && !loose.current) wish.set(0, 0)
    vel.current.lerp(wish, 1 - Math.exp(-dt * 9))
    const next = collider.resolve({ x: pos.current.x + vel.current.x * dt, y: pos.current.y + vel.current.y * dt })
    pos.current = next
    const speed = vel.current.length()
    bob.current += speed * dt * 5.2
    const amp = Math.min(speed / RUN, 1) * 0.018
    camera.position.set(next.x, collider.eye + Math.sin(bob.current) * amp, -next.y)
    // a footstep every stride, left and right in turn, louder and a little quicker as you go faster; the first one
    // soon after you set off
    if (speed > 0.25) {
      stride.current += speed * dt
      const stepAt = STRIDE * (1 + 0.25 * Math.min(1, Math.max(0, (speed - WALK) / (RUN - WALK))))
      if (stride.current >= stepAt) {
        stride.current = 0; foot.current = -foot.current
        sfx.play('step', { volume: 0.5 + 0.5 * Math.min(1, speed / RUN), rate: speed > WALK * 1.3 ? 1.08 : 1, pan: 0.18 * foot.current })
      }
    } else stride.current = STRIDE * 0.6
  })

  return (
    <PointerLockControls
      ref={controls}
      selector="#no-auto-lock"
      // a key still down from before (A / D browsing a screen) does not also walk you: it counts once pressed again
      // (loose, you were walking already)
      onLock={() => {
        locked.current = true
        if (!loose.current) Object.assign(keys.current, { f: false, b: false, l: false, r: false })
        loose.current = false
        onLockChange('locked')
      }}
      // Esc in a seat (not a screen flown to from it, nor another window): up, and on loose for now
      onUnlock={() => {
        locked.current = false
        loose.current = stale.current = seated.current && !inspecting.current && document.hasFocus()
        if (loose.current) seating.stand()
        onLockChange(loose.current ? 'loose' : null)
      }}
    />
  )
}
