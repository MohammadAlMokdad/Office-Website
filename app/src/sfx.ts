// Sound effects: short recordings (public/sfx/, real ones: keys, switches, the mouse, steps, cloth, chairs, from
// Mixkit, Freesound and Kenney, see LICENSE.txt there), a few clean tones made here for the devices and apps that
// beep, and a quiet room tone, through the one audio context (ui.ts) and one
// master gain: M mutes it all (kept in localStorage). A sound with a place (a light switch, a blind's motor, the TV)
// is panned and faded by distance from the listener, which follows the camera (SoundListener); your own sounds
// (steps, keys) are plain, or a little left or right. Nothing loads or plays before the first click (the browser's
// autoplay rule): Overlay's enter button calls start().
// Also here, because they are the same everywhere: the keys clicking while you type on any screen's page, the mouse
// clicking on a page, and M.
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { typing } from './htmlScreen'
import { audioContext } from './ui'

const BASE = import.meta.env.BASE_URL
type Def = {
  files: string[] // its recordings (public/sfx/), one at random each time, never the same twice running
  level: number // loudness, 0..1
  spread: number // pitch spread, ± a share
  gain?: number[] // per recording, to even out their loudness
  trim?: ([number, number] | null)[] // per recording: [from, for] seconds, the one event in a longer file
}
const SOUNDS = {
  step: { files: ['step_0.ogg', 'step_1.ogg', 'step_2.ogg', 'step_3.ogg', 'step_4.ogg'], level: 0.55, spread: 0.08 }, // a footstep on the tiles
  switch: { files: ['switch_tap.mp3', 'switch_quick.mp3', 'switch_short.mp3'], level: 0.55, spread: 0.04, gain: [0.6, 0.5, 1.4], trim: [[0, 0.5], [0, 0.5], null] }, // a light switch's rocker
  button: { files: ['key_soft.mp3'], level: 0.9, spread: 0.08, gain: [3] }, // a remote's soft rubber button, a key that works here, a small click in the UI
  clunk: { files: ['clunk_0.ogg'], level: 0.5, spread: 0.05 }, // a roller blind reaching the end of its travel
  blind_motor: { files: ['blind_motor.mp3'], level: 0.5, spread: 0.03 }, // a motorised roller blind running (motor(): looped while it travels)
  cloth: { files: ['cloth_0.ogg', 'cloth_1.ogg'], level: 0.55, spread: 0.08 }, // sitting down, getting up, settling at a desk
  creak: { files: ['creak_0.ogg', 'creak_1.ogg', 'creak_2.ogg', 'chair_squeak.mp3'], level: 0.4, spread: 0.08, gain: [1, 1, 1, 1.2], trim: [null, null, null, [0.05, 0.45]] }, // a chair taking your weight, letting go
  tv_on: { files: ['relay.mp3'], level: 0.5, spread: 0, trim: [[0.22, 0.5]] }, // the TV's relay as it comes on
  tv_off: { files: ['switch_short.mp3'], level: 0.45, spread: 0, gain: [1.2] }, // and off
  key: { files: ['key_soft.mp3', 'key_hard.mp3', 'key_single.mp3', 'key_presses.mp3'], level: 0.4, spread: 0.1, gain: [3.5, 1, 0.8, 0.8], trim: [null, null, [0, 0.4], [0.4, 0.35]] }, // a laptop key while you type on a screen
  mouse_down: { files: ['mouse_down.mp3'], level: 0.35, spread: 0.05, trim: [[0.1, 0.35]] }, // the mouse on a screen's page
  mouse_up: { files: ['mouse_up.mp3'], level: 0.3, spread: 0.05, trim: [[0.17, 0.3]] },
} as const satisfies Record<string, Def>
// Made here, not recorded: the clean tones of devices and apps (nothing game-like): the soundbar's and the intercom's
// beep, and a chat's soft pop as a message goes, two rising notes when the answer is in, a low double buzz when it
// failed. (ctx, where to play, when, loudness)
type Synth = (ctx: AudioContext, out: AudioNode, t: number, volume: number) => void
function tone(ctx: AudioContext, out: AudioNode, t: number, hz: number, seconds: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type; o.frequency.setValueAtTime(hz, t)
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + seconds)
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
  o.connect(g).connect(out); o.start(t); o.stop(t + seconds + 0.02)
}
const SYNTH = {
  toggle: (ctx, out, t, v) => tone(ctx, out, t, 1000, 0.07, 0.12 * v),
  send: (ctx, out, t, v) => tone(ctx, out, t, 640, 0.06, 0.09 * v, 'sine', 420),
  confirm: (ctx, out, t, v) => { tone(ctx, out, t, 740, 0.09, 0.08 * v); tone(ctx, out, t + 0.1, 988, 0.16, 0.08 * v) },
  error: (ctx, out, t, v) => { tone(ctx, out, t, 220, 0.08, 0.07 * v, 'square'); tone(ctx, out, t + 0.12, 196, 0.12, 0.07 * v, 'square') },
} as const satisfies Record<string, Synth>
export type Sound = keyof typeof SOUNDS | keyof typeof SYNTH
export type PlayOptions = {
  at?: THREE.Vector3 // where the sound is (three.js): panned and faded by distance
  volume?: number // x the sound's loudness
  rate?: number // x the recording's speed (pitch)
  pan?: number // -1 (left) .. 1 (right), for your own sounds
  delay?: number // s
  variant?: number // which recording (else one of them, never the same twice running)
}

const STORAGE = 'office-sound' // 'off' when muted
let master: GainNode | null = null
let muted = (() => { try { return localStorage.getItem(STORAGE) === 'off' } catch { return false } })()
const buffers = new Map<string, AudioBuffer>()
let loading: Promise<void> | null = null
let ambience: { stop: () => void } | null = null
const last: Partial<Record<Sound, number>> = {}
const played: Record<string, number> = {} // tests
const listeners = new Set<() => void>()

/** The master gain every sound goes through (a blind's motor too): mute silences it. */
export function output(): GainNode {
  const ctx = audioContext()
  if (!master) { master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination) }
  return master
}

async function load() {
  const ctx = audioContext()
  const files = [...new Set(Object.values(SOUNDS).flatMap((d) => d.files as readonly string[]))]
  await Promise.all(files.map(async (f) => {
    try {
      const r = await fetch(`${BASE}sfx/${f}`)
      if (!r.ok) throw new Error(`${r.status}`)
      buffers.set(f, await ctx.decodeAudioData(await r.arrayBuffer()))
    } catch (e) { console.warn(`sfx: ${f} did not load`, e) }
  }))
}

/** A panner at a place in the room, for a sound that lives there. */
function panner(at: THREE.Vector3) {
  const ctx = audioContext()
  const p = ctx.createPanner()
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 1.2; p.maxDistance = 30
  if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z } else p.setPosition(at.x, at.y, at.z)
  p.connect(output())
  return p
}

/** The old click (ui.ts), for a button before its recording is loaded. */
function synthClick() {
  const ctx = audioContext()
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.03)
  g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  o.connect(g).connect(output()); o.start(t); o.stop(t + 0.06)
}

/** A quiet room tone: air (filtered noise) and the air conditioner's hum, fading in. */
function roomTone() {
  const ctx = audioContext()
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b = 0
  for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3 } // brown-ish noise
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500
  const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 100
  const humGain = ctx.createGain(); humGain.gain.value = 0.12
  const g = ctx.createGain()
  const t = ctx.currentTime
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 3)
  noise.connect(lp).connect(g); hum.connect(humGain).connect(g); g.connect(output())
  noise.start(t); hum.start(t)
  return {
    stop: () => {
      const t = ctx.currentTime
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      noise.stop(t + 0.6); hum.stop(t + 0.6); setTimeout(() => g.disconnect(), 800)
    },
  }
}

let running = 0 // motors running (tests)
/** A roller blind's motor at a window (Blinds.tsx): the recording of one, looped over its steady part while the blind
 *  travels; stop() fades it out (the end stop's clunk is the blind's own). Silent until the recording is loaded. */
export function motor(at: THREE.Vector3): { stop: () => void } {
  const buf = buffers.get('blind_motor.mp3')
  if (!buf || !master) return { stop: () => {} }
  const ctx = audioContext()
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = buf; src.loop = true; src.loopStart = 1.0; src.loopEnd = Math.min(6.0, buf.duration - 0.5)
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * SOUNDS.blind_motor.spread
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(SOUNDS.blind_motor.level, t + 0.12)
  const p = panner(at)
  src.connect(g).connect(p)
  src.start(t, 0.25) // the motor starting
  running++
  let stopped = false
  return {
    stop: () => {
      if (stopped) return
      stopped = true; running--
      const t = ctx.currentTime
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      src.stop(t + 0.25)
      setTimeout(() => { g.disconnect(); p.disconnect() }, 400)
    },
  }
}

function play(name: Sound, o: PlayOptions = {}) {
  played[name] = (played[name] ?? 0) + 1
  if (name in SYNTH) {
    if (!master) return
    const ctx = audioContext()
    const synth = (SYNTH as Record<string, Synth>)[name]
    synth(ctx, o.at ? panner(o.at) : output(), ctx.currentTime + (o.delay ?? 0), o.volume ?? 1)
    return
  }
  const def: Def = SOUNDS[name as keyof typeof SOUNDS]
  const count = def.files.length
  let i = o.variant ?? Math.floor(Math.random() * count)
  if (count > 1 && i === last[name]) i = (i + 1) % count
  last[name] = i
  const buf = buffers.get(def.files[i])
  if (!buf) { if (name === 'button' || name === 'switch') synthClick(); return }
  const ctx = audioContext()
  const t = ctx.currentTime + (o.delay ?? 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * def.spread)
  const g = ctx.createGain()
  g.gain.value = def.level * (o.volume ?? 1) * (def.gain?.[i] ?? 1)
  src.connect(g)
  let node: AudioNode = g
  if (o.at) node = panner(o.at), g.connect(node)
  else {
    if (o.pan) { const s = ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(s); node = s }
    node.connect(output())
  }
  const trim = def.trim?.[i]
  if (trim) src.start(t, trim[0], trim[1]); else src.start(t)
}

function setMuted(m: boolean) {
  muted = m
  try { localStorage.setItem(STORAGE, m ? 'off' : 'on') } catch { /* private mode */ }
  if (master) { const t = audioContext().currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(m ? 0 : 1, t, 0.04) }
  listeners.forEach((f) => f())
}

export const sfx = {
  play,
  /** From the first click (the enter button): the context runs, the recordings load, the room tone starts. */
  start() {
    const ctx = audioContext()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    output()
    loading ??= load()
    ambience ??= roomTone()
  },
  muted: () => muted,
  setMuted,
  toggleMute: () => setMuted(!muted),
  /** For useSyncExternalStore: muted or not. */
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } },
  loaded: () => loading?.then(() => buffers.size) ?? Promise.resolve(0),
}

const fwd = new THREE.Vector3(), up = new THREE.Vector3()
/** Inside the Canvas: the listener follows the camera every frame. */
export function SoundListener() {
  useFrame(({ camera }) => {
    if (!master) return // nothing plays before the first click
    const ctx = audioContext(), l = ctx.listener, p = camera.position
    camera.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z) }
  })
  return null
}

// the same everywhere: M mutes; the keys click while you type on a screen's page; the mouse clicks on a page
const TYPING_KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', ' '])
window.addEventListener('keydown', (e) => {
  if (e.repeat) return
  const inBox = typing(e.target)
  if (e.code === 'KeyM' && !inBox && !e.ctrlKey && !e.metaKey && !e.altKey) { sfx.toggleMute(); return }
  if (inBox && master && !e.ctrlKey && !e.metaKey && (e.key.length === 1 || TYPING_KEYS.has(e.key))) play('key', { volume: e.key === 'Enter' || e.key === ' ' ? 1.3 : 1 })
})
let pressed = false
const onPage = (t: EventTarget | null) => !document.pointerLockElement && !!(t as Element | null)?.closest?.('.screen-page')
window.addEventListener('mousedown', (e) => { if (e.button === 0 && master && onPage(e.target)) { pressed = true; play('mouse_down') } }, true)
window.addEventListener('mouseup', () => { if (pressed) { pressed = false; play('mouse_up') } }, true)
if (new URLSearchParams(window.location.search).has('debug')) Object.assign(window, { __sfx: { played, sfx, buffers, motors: () => running } }) // tests
