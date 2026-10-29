// The TV: YouTube on the TV's glass (TVApp.tsx: home, search, results; YouTube's own player for the video), shown and
// used like every web page on a screen (htmlScreen.ts).
// - E on the TV (its label is up): it switches on if it is off and the camera flies up to it (inspect.ts): search,
//   pick, YouTube's own player controls. E there switches the TV off, H goes back to YouTube's home / search; Esc and
//   you are back where you were.
// - The TV remote on the recliner has T: by the recliner, T switches the TV on and off (nowhere else).
// - B switches the soundbar, and with a video on: Space pauses / plays, N next, P previous (YouTube's player itself):
//   by the recliner (its remote there is tagged with B) or while the TV's label is up.
// - The page cannot touch YouTube's sound, only its volume: the soundbar makes it louder, distance quieter.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { HtmlScreen, typing } from './htmlScreen'
import { inspect } from './inspect'
import { addUsable, focused, setShortcuts, type Shortcut, type Usable } from './interact'
import { scene as manifest } from './scene'
import { callout, click } from './ui'
import { type TVActions, TVApp } from './TVApp'
import { sfx } from './sfx'

const PX = 1280 // the TV's width in CSS pixels
const VOLUME = { tv: 35, soundbar: 80 } // YouTube volume (0..100) up close: the TV's own speakers, the soundbar
const NEAR = 2 // m: full volume up to here, then it falls off with distance
const TV_REACH = 5 // m (plan): the TV's label shows from the recliner and around the coffee table
const HANDY = 1.3 // m from the remotes (plan): T and B work there
const LABELS = 2.6 // m from the remotes (plan): their labels show

type YTPlayer = {
  playVideo(): void; pauseVideo(): void; stopVideo(): void; nextVideo(): void; previousVideo(): void
  loadPlaylist(ids: string[], index: number): void
  setVolume(v: number): void; mute(): void; unMute(): void; getPlayerState(): number
}
type YTOptions = {
  host: string; videoId: string; width: string; height: string; playerVars: Record<string, string | number>
  events: { onReady: () => void }
}
type YTNamespace = { Player: new (el: HTMLElement, opts: YTOptions) => YTPlayer }
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

let api: Promise<YTNamespace> | null = null
function youtubeAPI() {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s)
  })
  return api
}

/** For the overlay: what the TV is doing, and its buttons while you use it. */
export type TVState = { on: boolean; soundbar: boolean; video: boolean }
let shown: TVState = { on: false, soundbar: false, video: false }
const listeners = new Set<() => void>()
const publish = (next: Partial<TVState>) => { shown = { ...shown, ...next }; listeners.forEach((f) => f()) }
export const tvUi = {
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } },
  get: () => shown,
  power: () => {},
  soundbar: () => {},
  browse: () => {},
}

export function TV({ screen }: { screen: THREE.Mesh }) {
  const camera = useThree((s) => s.camera)

  const tv = useMemo(() => {
    const remoteAt = (key: string) => {
      const p = manifest.props?.[key]
      return p ? new THREE.Vector3(p.center[0], p.box[1][1], p.center[2]) : new THREE.Vector3() // on top of the remote
    }
    return {
      page: null as HtmlScreen | null, usable: null as Usable | null,
      playerHost: document.createElement('div'), appHost: document.createElement('div'),
      callouts: [
        { el: callout('T', 'TV'), at: remoteAt('tvRemote'), on: false },
        { el: callout('B', 'Soundbar'), at: remoteAt('soundbarRemote'), on: false },
      ],
      remotes: remoteAt('tvRemote').add(remoteAt('soundbarRemote')).multiplyScalar(0.5), // between the two, on the recliner
      on: false, soundbar: false, byRemotes: false, player: null as YTPlayer | null, volume: -1, handy: false, keys: [] as Shortcut[],
    }
  }, [])

  useEffect(() => {
    const page = new HtmlScreen(screen, 'tv', PX)
    tv.page = page
    Object.assign(tv.playerHost.style, { position: 'absolute', inset: '0', display: 'none' })
    Object.assign(tv.appHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }) // the app's page takes clicks
    page.el.append(tv.playerHost, tv.appHost)
    tv.callouts.forEach((c) => document.body.appendChild(c.el))
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __tv: tv }) // tests
    let root: ReturnType<typeof createRoot> | null = null

    // the YouTube app hands the TV a list to play from one of its videos: YouTube's player gets it as a playlist
    let creating = false, pending: [string[], number] | null = null
    const actions: TVActions = {
      play: (ids, at) => {
        tv.playerHost.style.display = 'block'; publish({ video: true })
        if (tv.player) { tv.player.loadPlaylist(ids, at); tv.player.unMute(); return }
        pending = [ids, at]
        if (creating) return
        creating = true
        const slot = document.createElement('div'); tv.playerHost.appendChild(slot)
        youtubeAPI().then((YT) => {
          const p = new YT.Player(slot, {
            host: 'https://www.youtube-nocookie.com', videoId: ids[at], width: '100%', height: '100%',
            playerVars: { autoplay: 1, controls: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, origin: location.origin },
            events: {
              onReady: () => {
                tv.player = p; tv.volume = -1
                if (pending) p.loadPlaylist(...pending)
                p.unMute()
                // if the browser will not start it with sound, start it muted rather than not at all
                setTimeout(() => { if (tv.on && p.getPlayerState() !== 1) { p.mute(); p.playVideo() } }, 2500)
              },
            },
          })
        })
      },
      browse: () => {}, // the app's
    }
    const video = () => tv.on && tv.playerHost.style.display !== 'none' // a video is on the TV
    const look = () => inspect.enter('tv', [{ frame: page, page }], { settle: false })
    const switchTV = () => {
      tv.on = !tv.on
      sfx.play(tv.on ? 'tv_on' : 'tv_off', { at: page.center })
      if (!tv.on && inspect.name() === 'tv') inspect.leave() // back, inside the key press or click that switched it off
      page.show(tv.on)
      publish({ on: tv.on })
      if (!tv.on) { if (tv.playerHost.style.display !== 'none') tv.player?.pauseVideo(); return } // (video() is false now)
      if (video()) tv.player?.playVideo()
      if (!root) { root = createRoot(tv.appHost); root.render(<TVApp actions={actions} />) }
    }
    const switchSoundbar = () => { tv.soundbar = !tv.soundbar; sfx.play('toggle', { at: page.center, variant: tv.soundbar ? 0 : 1 }); publish({ soundbar: tv.soundbar }) }
    tvUi.power = () => { click(); switchTV() }
    tvUi.soundbar = () => { click(); switchSoundbar() }
    tvUi.browse = () => { tv.player?.stopVideo(); tv.playerHost.style.display = 'none'; publish({ video: false }); actions.browse() }

    // keys while you use the TV (not while typing in its search box); Esc is inspect's
    const keys = (e: KeyboardEvent) => {
      if (!page.using || e.repeat || typing(e.target) || e.timeStamp <= page.since) return // (not the E that came in)
      const act = { KeyE: tvUi.power, KeyH: tvUi.browse, KeyB: tvUi.soundbar }[e.code]
      if (act && (e.code !== 'KeyH' || video())) { e.preventDefault(); act() }
    }
    window.addEventListener('keydown', keys)

    tv.usable = {
      at: page.center, facing: page.normal, reach: TV_REACH, lift: page.size[1] / 2 + 0.1, icon: 'tv',
      label: () => (tv.on ? 'YouTube' : 'TV'),
      use: () => { if (!tv.on) { click(); switchTV() } look() },
    }
    const removeUsable = addUsable(tv.usable)
    tv.keys = [
      { code: 'KeyT', key: 'T', label: () => (tv.on ? 'TV off' : 'TV on'), use: () => { click(); switchTV() }, enabled: () => tv.byRemotes },
      { code: 'KeyB', key: 'B', label: () => (tv.soundbar ? 'soundbar off' : 'soundbar on'), use: () => { click(); switchSoundbar() } },
      { code: 'Space', key: 'Space', label: () => (tv.player?.getPlayerState() === 1 ? 'pause' : 'play'), use: () => { click(); if (tv.player?.getPlayerState() === 1) tv.player.pauseVideo(); else tv.player?.playVideo() }, enabled: video },
      { code: 'KeyN', key: 'N', label: () => 'next', use: () => { click(); tv.player?.nextVideo() }, enabled: video },
      { code: 'KeyP', key: 'P', label: () => 'previous', use: () => { click(); tv.player?.previousVideo() }, enabled: video },
    ]
    return () => {
      removeUsable()
      if (tv.handy) { tv.handy = false; setShortcuts([]) }
      window.removeEventListener('keydown', keys)
      tvUi.power = tvUi.soundbar = tvUi.browse = () => {}
      tv.callouts.forEach((c) => c.el.remove())
      page.dispose(); tv.page = null
      const r = root
      if (r) setTimeout(() => r.unmount()) // not while React is rendering
    }
  }, [tv, screen])

  const p = useMemo(() => new THREE.Vector3(), [])
  // every frame (after Player moved the camera: mounted later): where T / B work, the remote tags, the volume
  useFrame((state) => {
    if (!tv.page) return
    const locked = !!document.pointerLockElement && !inspect.name()
    const near = Math.hypot(camera.position.x - tv.remotes.x, camera.position.z - tv.remotes.z)
    tv.byRemotes = near < HANDY
    const handy = locked && (tv.byRemotes || (!!tv.usable && focused(tv.usable)))
    if (handy !== tv.handy) { tv.handy = handy; setShortcuts(handy ? tv.keys : []) }
    for (const c of tv.callouts) {
      let on = locked && near < LABELS
      if (on) {
        p.copy(c.at).project(camera)
        on = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05
        if (on) c.el.style.transform = `translate(${((p.x + 1) / 2) * state.size.width}px, ${((1 - p.y) / 2) * state.size.height}px)`
      }
      if (on !== c.on) { c.on = on; c.el.style.display = on ? '' : 'none' }
    }
    if (!tv.on || !tv.player) return
    const d = camera.position.distanceTo(tv.page.center)
    const v = sfx.muted() ? 0 : Math.round((tv.soundbar ? VOLUME.soundbar : VOLUME.tv) * Math.min(1, NEAR / d))
    if (v !== tv.volume) { tv.volume = v; tv.player.setVolume(v) }
  })
  return null
}
