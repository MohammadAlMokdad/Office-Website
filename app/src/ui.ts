// Small pieces shared by the things with keys (the TV's remotes, the blinds' remotes): a short click sound and a tag
// that floats over a remote with its key.
import { sfx } from './sfx'


let audio: AudioContext | null = null
/** The shared audio context (for other small sounds, e.g. a blind's motor). */
export const audioContext = () => (audio ??= new AudioContext())

/** A short click, as from a remote's button (sfx.ts: a recording, or a synthesised click until it is loaded). */
export function click() { sfx.play('button') }

/** A small tag floating just above a remote: its key and what it is (styles.css .callout; hidden until placed). */
export function callout(key: string, what: string) {
  const el = document.createElement('div')
  el.className = 'callout'
  el.innerHTML = `<kbd>${key}</kbd>${what}`
  el.style.display = 'none'
  return el
}
