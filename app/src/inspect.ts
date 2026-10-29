// Looking closely, the way office.graffico.it does it: E on a desk or the TV and the camera flies up to it and the mouse
// is free (a web page on a screen takes the clicks: htmlScreen.ts). W A S D or the arrows (or the round arrows at the
// sides) move between the views of a desk: its screens one by one and the whole desk. Esc, or the corner button, flies
// you back to where you were, seated or standing, and you walk again. While you type on a screen the keys type; a click
// outside the text box and they move the view again.
import * as THREE from 'three'
import { type HtmlScreen, typing } from './htmlScreen'
import { camRig, type Frame, pointer } from './Player'
import { scene as manifest } from './scene'
import { sfx } from './sfx'

export type View = { frame: Frame; page?: HtmlScreen } // `page`: the web page on a screen in view, used while you look
const AGAIN = 700 // ms after flying back before E flies you in again
// After Esc the mouse is locked again once the camera is back (Esc itself does not count as a click for the browser,
// and Chrome refuses a lock for about a second after it): a second try if needed, and no pause menu meanwhile.
const RETRY = 1100, QUIET = 1500 // ms
let settled = false // you sat down at what you look at (the sounds of getting up on the way back)

/** A screen's frame from scene.json (screen meshes are named screen_<object>). */
export function frameOf(mesh: string): Frame | null {
  const f = manifest.screens?.[mesh]?.frame
  return f ? { center: new THREE.Vector3(...f.center), normal: new THREE.Vector3(...f.normal), size: f.size } : null
}

/** One frame around several (a desk's screens), facing their average way; `pad` x its size (bezels, a screen turned
 *  towards you looks wider than its frame). */
export function frameAround(frames: Frame[], pad = 1.25): Frame {
  const n = frames.reduce((s, f) => s.add(f.normal), new THREE.Vector3()).normalize()
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, n).normalize()
  const mid = frames.reduce((s, f) => s.add(f.center), new THREE.Vector3()).divideScalar(frames.length)
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], d = new THREE.Vector3()
  for (const f of frames) {
    const r = new THREE.Vector3().crossVectors(up, f.normal).normalize()
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      d.copy(f.center).addScaledVector(r, (a * f.size[0]) / 2).addScaledVector(up, (b * f.size[1]) / 2).sub(mid)
      const x = d.dot(right), y = d.dot(up)
      lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y)
    }
  }
  const center = mid.addScaledVector(right, (lo[0] + hi[0]) / 2).addScaledVector(up, (lo[1] + hi[1]) / 2)
  return { center, normal: n, size: [(hi[0] - lo[0]) * pad, (hi[1] - lo[1]) * pad] }
}

type State = { looking: { name: string; views: number; index: number } | null; relocking: boolean }
let name: string | null = null, views: View[] = [], cols = 1, index = 0, left = -Infinity
let relocking = false, timers: number[] = []
let shown: State = { looking: null, relocking: false }
const listeners = new Set<() => void>()
const publish = () => { shown = { looking: name ? { name, views: views.length, index } : null, relocking }; listeners.forEach((f) => f()) }

function show(i: number) {
  const was = views[index]?.page, next = views[i]
  if (was && was !== next.page) was.leave()
  index = i
  camRig.frame(next.frame)
  next.page?.use()
  publish()
}

function relock() {
  timers.forEach(clearTimeout)
  if (document.pointerLockElement) { relocking = false; publish(); return }
  relocking = true; publish()
  pointer.lock()
  timers = [
    window.setTimeout(() => { if (!document.pointerLockElement) pointer.lock() }, RETRY),
    window.setTimeout(() => { relocking = false; publish() }, QUIET),
  ]
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement && relocking) { timers.forEach(clearTimeout); relocking = false; publish() }
})

/** For the overlay (useSyncExternalStore) and the things you can look at. */
export const inspect = {
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } },
  get: () => shown,
  /** What you are looking at closely ('tv', 'salah', ...), or null. */
  name: () => name,
  /** Fly to a view (`start`) of a list; `columns`: views in a grid this wide (W / S move a row; 1 = like A / D);
   *  `settle`: you sit down at it (a desk: cloth, the chair), not for the TV, which you watch from where you are. */
  enter(what: string, list: View[], { start = 0, columns = 1, settle = true } = {}) {
    if (name || !list.length || performance.now() - left < AGAIN) return
    name = what; views = list; cols = columns; index = start
    document.exitPointerLock()
    settled = settle
    if (settle) { sfx.play('cloth'); sfx.play('creak', { delay: 0.3, volume: 0.6 }) } // settling at the desk
    show(start)
  },
  step(d: number) {
    const i = (((index + d) % views.length) + views.length) % views.length
    if (name && i !== index) { sfx.play('button', { volume: 0.6 }); show(i) }
  },
  /** Back to walking. `lock`: 'now' inside a click or a key press that counts as one (E), 'after' (Esc) once the
   *  camera is back, false not at all. */
  leave(lock: 'now' | 'after' | false = 'now') {
    if (!name) return
    views[index].page?.leave()
    name = null; views = []; left = performance.now()
    if (settled) { sfx.play('creak', { volume: 0.5 }); sfx.play('cloth', { delay: 0.1 }) } // and up again
    settled = false
    timers.forEach(clearTimeout)
    relocking = !!lock // no pause menu on the way back either
    camRig.back(lock === 'after' ? () => relock() : undefined)
    if (lock === 'now') relock()
    else if (lock === 'after') timers = [window.setTimeout(relock, 1000)] // (if the flight back was cut short)
    publish()
  },
}
if (new URLSearchParams(window.location.search).has('debug')) Object.assign(window, { __inspect: inspect }) // tests

window.addEventListener('keydown', (e) => {
  if (!name || e.repeat) return
  if (e.code === 'Escape') { e.preventDefault(); inspect.leave('after'); return } // also while typing on a screen
  if (typing(e.target)) return // the keys type
  const d = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1, KeyW: -cols, ArrowUp: -cols, KeyS: cols, ArrowDown: cols }[e.code]
  if (d && views.length > 1) { e.preventDefault(); inspect.step(d) }
})
// a click outside the text box you were typing in: it lets go of the keys (they move the view again). CodeMirror's
// editor (the laptops) is editable text inside .cm-editor: the box is the whole editor, gutter and scrollbar included
window.addEventListener('mousedown', (e) => {
  const t = document.activeElement
  if (!name || !typing(t)) return
  const box = t as HTMLElement, editor = box.closest('.cm-editor') ?? box
  if (!editor.contains(e.target as Node)) box.blur()
}, true)
