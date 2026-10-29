// Things you can use, the way office.graffico.it does it: walk up to one and turn its way, and a small label shows over
// it (what it is, "press E"); E uses it (the mouse button does nothing). Of the things within their reach and in front
// of you, the one nearest the middle of the view is the one. A standing hint (Esc to stand up while seated) is shown in
// a corner, out of the view.
// Shortcuts: single keys that work where you are (T on the TV remote, B for the soundbar, Space / N / P for the video
// on the TV), listed in another corner.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const ICONS = {
  seat: 'M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5M4 11h16v5H4zM6 16v4M18 16v4',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  monitor: 'M3 4h18v12H3zM9 20h6M12 16v4',
  play: 'M3 4h18v12H3zM10 7.5v5l4.5-2.5zM9 20h6M12 16v4',
  power: 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0',
  laptop: 'M4 5h16v11H4zM2 19h20M9 19v-3M15 19v-3',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  blinds: 'M3 4h18M4 4v4h16V4M4 8v4h16V8M4 12v4h16v-4M12 16v5',
}
export type Usable = {
  at: THREE.Vector3 // the thing's middle: reach and "in front of you" count from here
  label: () => string // a word or two (shown in capitals)
  use: () => void
  icon?: keyof typeof ICONS
  reach?: number // m on the floor plan, from you to `at`
  facing?: THREE.Vector3 // a screen: usable from its front only
  lift?: number // m above `at`: where the label floats
  enabled?: () => boolean
}
type Hint = { label: string; key: string } | null
export type Focus = { target: Hint; seated: boolean }

const REACH = 2 // m, unless the usable says otherwise
const FRONT = Math.cos(THREE.MathUtils.degToRad(50)) // within this angle of the middle of the view
const params = new URLSearchParams(window.location.search)
const usables: Usable[] = []
if (params.has('debug')) Object.assign(window, { __usables: usables }) // tests
let current: Usable | null = null
let seated = false
let paused = false
let shown: Focus = { target: null, seated: false }
const listeners = new Set<() => void>()
const notify = () => {
  const next = { target: current && { label: current.label(), key: 'E' }, seated }
  if (JSON.stringify(next) !== JSON.stringify(shown)) { shown = next; listeners.forEach((f) => f()) }
}

export function addUsable(u: Usable) {
  usables.push(u)
  return () => { usables.splice(usables.indexOf(u), 1); if (current === u) { current = null; notify() } }
}
/** Whether this one's label is up (E would use it). */
export const focused = (u: Usable) => current === u
/** Player: seated (the standing hint shows). */
export function setSeated(on: boolean) { seated = on; notify() }
/** Player: no labels while the camera glides or looks at a screen closely. */
export function pauseUsables(on: boolean) { paused = on }

export type Shortcut = { code: string; key: string; label: () => string; use: () => void; enabled?: () => boolean }
// several things have keys (the TV's remotes, the blinds' remotes): each sets its own list under its own name
const sources = new Map<string, Shortcut[]>()
const shortcuts = () => [...sources.values()].flat()
let shownKeys: { key: string; label: string }[] = []
const keyListeners = new Set<() => void>()
const notifyKeys = () => {
  const next = shortcuts().filter((s) => s.enabled?.() ?? true).map((s) => ({ key: s.key, label: s.label() }))
  if (JSON.stringify(next) !== JSON.stringify(shownKeys)) { shownKeys = next; keyListeners.forEach((f) => f()) }
}
/** The keys that work here, from one source (the TV, the blinds...); an empty list clears that source's keys. */
export function setShortcuts(list: Shortcut[], source = 'tv') { if (list.length) sources.set(source, list); else sources.delete(source); notifyKeys() }
/** For useSyncExternalStore: the shortcuts that work here. */
export const shortcutList = {
  subscribe: (f: () => void) => { keyListeners.add(f); return () => { keyListeners.delete(f) } },
  get: () => shownKeys,
}

/** For useSyncExternalStore: what E would do now (target) and whether you are seated. */
export const focus = {
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } },
  get: () => shown,
}

// the label: pinned over the thing, kept inside the window
const pill = document.createElement('div')
pill.className = 'prompt'
let pillText = '', pillSize = [0, 0]
const MARGIN = 16 // px from the window's edges

export function Interaction() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const v = useMemo(() => ({ fwd: new THREE.Vector3(), to: new THREE.Vector3(), p: new THREE.Vector3() }), [])
  useEffect(() => {
    if (!params.has('noui')) document.body.appendChild(pill)
    return () => pill.remove()
  }, [])
  useFrame(() => {
    current = null
    if (document.pointerLockElement && !paused) {
      camera.getWorldDirection(v.fwd)
      let best = FRONT
      for (const u of usables) {
        if (!(u.enabled?.() ?? true)) continue
        v.to.subVectors(u.at, camera.position)
        if (Math.hypot(v.to.x, v.to.z) > (u.reach ?? REACH)) continue
        if (u.facing && v.to.dot(u.facing) >= 0) continue // behind it
        const c = v.to.dot(v.fwd) / v.to.length()
        if (c > best) { best = c; current = u }
      }
    }
    notify(); notifyKeys() // labels follow what happened (a usable or a button may have switched something)
    if (!current) { if (pillText) { pillText = ''; pill.classList.remove('on') } return }
    const text = `${current.icon ?? ''}|${current.label()}`
    if (text !== pillText) {
      pillText = text
      const icon = current.icon ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[current.icon]}"/></svg>` : ''
      pill.innerHTML = `${icon}<b>${current.label()}</b><i></i><span>press <kbd>E</kbd></span>`
      pill.classList.add('on')
      pillSize = [pill.offsetWidth, pill.offsetHeight]
    }
    v.p.copy(current.at).setY(current.at.y + (current.lift ?? 0.15)).project(camera)
    const x = Math.min(Math.max(((v.p.x + 1) / 2) * size.width, MARGIN + pillSize[0] / 2), size.width - MARGIN - pillSize[0] / 2)
    const y = Math.min(Math.max(((1 - v.p.y) / 2) * size.height, MARGIN + pillSize[1]), size.height - MARGIN)
    pill.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
  })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || !document.pointerLockElement) return
      if (e.code === 'KeyE' && current) { current.use(); notify() }
      const s = shortcuts().find((x) => x.code === e.code && (x.enabled?.() ?? true))
      if (s) { e.preventDefault(); s.use(); notify(); notifyKeys() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return null
}
