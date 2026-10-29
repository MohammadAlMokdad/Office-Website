// Loading bar, start / pause screen with the controls, crosshair, the corners (the way out on the left, keys on the
// right) while walking, seated and while you look at a screen closely, credits, and a desktop-only notice. The labels
// over things you can use are interact.ts's.
import { useProgress } from '@react-three/drei'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { CREDITS } from './credits'
import { inspect } from './inspect'
import { focus, shortcutList } from './interact'
import { type Mouse, pointer } from './Player'
import { tvUi } from './TV'
import { sfx } from './sfx'

const touchOnly = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches

export function Overlay({ mouse, started }: { mouse: Mouse; started: boolean }) {
  const { progress, active } = useProgress()
  const [credits, setCredits] = useState(false)
  const usable = useSyncExternalStore(focus.subscribe, focus.get)
  const keys = useSyncExternalStore(shortcutList.subscribe, shortcutList.get)
  const tv = useSyncExternalStore(tvUi.subscribe, tvUi.get)
  const { looking, relocking } = useSyncExternalStore(inspect.subscribe, inspect.get)
  // Chrome refuses a new pointer lock for about a second after Esc, so hold the Continue button until then
  const [cooling, setCooling] = useState(false)
  useEffect(() => {
    if (mouse || !started) return
    setCooling(true)
    const t = setTimeout(() => setCooling(false), 1100)
    return () => clearTimeout(t)
  }, [mouse, started])
  const loading = active || progress < 100
  const soundOff = useSyncExternalStore(sfx.subscribe, sfx.muted)

  if (touchOnly) {
    return (
      <div className="screen">
        <div className="card">
          <h1>The Office</h1>
          <p className="sub">Beirut</p>
          <p>This walk-through is made for a computer with a keyboard and mouse. Please open it on a desktop or laptop.</p>
        </div>
      </div>
    )
  }

  if (looking) {
    // looking at a screen closely: the mouse is free here, so the corners can be clicked too
    const browse = looking.views > 1
    return (
      <>
        <button className="back-to-walking clickable" onClick={() => inspect.leave()}><span>✕</span> {usable.seated ? 'Back' : 'Back to walking'} <small>(Esc)</small></button>
        {browse && <button className="browse-arrow left clickable" aria-label="Previous view" onClick={() => inspect.step(-1)} />}
        {browse && <button className="browse-arrow right clickable" aria-label="Next view" onClick={() => inspect.step(1)} />}
        {(looking.name === 'tv' || browse) && (
          <div className="shortcuts clickable">
            {browse && <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>←</kbd><kbd>→</kbd> to browse</span>}
            {looking.name === 'tv' && (
              <>
                <button onClick={() => tvUi.power()}><kbd>E</kbd> TV off</button>
                {tv.video && <button onClick={() => tvUi.browse()}><kbd>H</kbd> YouTube home / search</button>}
                <button onClick={() => tvUi.soundbar()}><kbd>B</kbd> {tv.soundbar ? 'soundbar off' : 'soundbar on'}</button>
              </>
            )}
          </div>
        )}
      </>
    )
  }

  // just back from a screen (Esc): the mouse locks again by itself in a moment, no pause menu meanwhile (a click
  // anywhere does it at once)
  if (relocking && !mouse) return <div className="relock" onClick={() => pointer.lock()} />

  // just up from a seat (Esc): you walk and look on, and the mouse locks again at your next key press or click
  if (mouse === 'loose') return <><div className="relock" onClick={() => pointer.lock()} /><div className="crosshair" /></>

  if (mouse === 'locked') {
    return (
      <>
        <div className={usable.target ? 'crosshair on' : 'crosshair'} />
        {usable.seated && <div className="back-to-walking"><span>✕</span> Stand up <small>(Esc)</small></div>}
        {keys.length > 0 && (
          <div className="shortcuts">
            {keys.map((k) => <span key={k.key}><kbd>{k.key}</kbd> {k.label}</span>)}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>The Office</h1>
        <p className="sub">Beirut</p>
        {loading ? (
          <div className="loading">
            <div className="bar"><div style={{ width: `${progress.toFixed(0)}%` }} /></div>
            <p className="hint">Loading the office… {progress.toFixed(0)}%</p>
          </div>
        ) : (
          <>
            <button className="enter" disabled={cooling} onClick={() => { sfx.start(); pointer.lock() }}>{started ? 'Continue' : 'Click to enter'}</button>
            <ul className="keys">
              <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows · walk</li>
              <li><kbd>Mouse</kbd> · look around</li>
              <li><kbd>Shift</kbd> · walk faster</li>
              <li><kbd>E</kbd> · when a label shows: sit, the TV, a desk, a light switch</li>
              <li><kbd>Esc</kbd> · get up, back to walking from a screen; pause</li>
              <li><kbd>T</kbd> <kbd>B</kbd> by the recliner · the TV remote, the soundbar remote</li>
              <li><kbd>1</kbd> <kbd>2</kbd> by the drawer unit · the blinds’ remotes (blackout, sheer)</li>
              <li><kbd>M</kbd> · sound {soundOff ? 'on (it is off now)' : 'off'}</li>
            </ul>
          </>
        )}
        <button className="link" onClick={() => setCredits(true)}>Credits</button>
      </div>
      {credits && (
        <div className="credits" onClick={() => setCredits(false)}>
          <div className="card wide" onClick={(e) => e.stopPropagation()}>
            <h2>Credits</h2>
            <p className="hint">These models are used under CC BY 4.0 and were modified for this scene. Everything else was modelled for this project. Sound effects: <a href="https://mixkit.co" target="_blank" rel="noreferrer">Mixkit</a>, <a href="https://freesound.org/people/martin-bn/sounds/500313/" target="_blank" rel="noreferrer">martin-bn on Freesound</a> (CC0) and <a href="https://kenney.nl" target="_blank" rel="noreferrer">Kenney</a> (CC0).</p>
            <ul>
              {CREDITS.map((c) => (
                <li key={c.url}>
                  <span className="use">{c.use}</span>
                  <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> by <a href={c.authorUrl} target="_blank" rel="noreferrer">{c.author}</a>
                </li>
              ))}
            </ul>
            <button className="link" onClick={() => setCredits(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
