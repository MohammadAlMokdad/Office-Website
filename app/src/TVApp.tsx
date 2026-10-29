// The TV's YouTube app: a home page (what is popular in Lebanon), search, results with thumbnails. Picking a video hands
// the whole list to YouTube's own player (TV.tsx) as a playlist, so its own controls do the rest: pause, previous,
// next, sound, captions, settings, the next video when one ends. Data from the YouTube Data API (key:
// VITE_YOUTUBE_KEY in app/.env.local). Results are cached in the browser to spare the daily quota: 10,000 units, a
// search costs 100, the home page 1.
import { useCallback, useEffect, useState } from 'react'

export type Video = { id: string; title: string; channel: string; thumb: string; duration: string; views: string; when: string }
/** Between the app and the TV: the TV plays a list from a given video; the app sets `browse`, which the TV calls to put
 * the results back on screen. */
export type TVActions = { play: (ids: string[], at: number) => void; browse: () => void }

const KEY = import.meta.env.VITE_YOUTUBE_KEY as string | undefined
const API = 'https://www.googleapis.com/youtube/v3'
const REGION = 'LB'
const COUNT = 24
// without a key: the Blender Foundation's open movies
const FALLBACK: Video[] = [
  ['aqz-KE-bpKQ', 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film'],
  ['eRsGyueVLvQ', 'Sintel - Open Movie by Blender Foundation'],
  ['R6MlUcmOul8', 'Tears of Steel - Blender VFX Open Movie'],
  ['WhWc3b3KhnY', 'Spring - Blender Open Movie'],
].map(([id, title]) => ({ id, title, channel: 'Blender', thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, duration: '', views: '', when: '' }))

type ApiVideo = {
  id: string
  snippet: { title: string; channelTitle: string; publishedAt: string; thumbnails: Record<string, { url: string }> }
  contentDetails?: { duration: string }
  statistics?: { viewCount?: string }
  status?: { embeddable?: boolean }
}

async function api<T>(path: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: KEY ?? '' })}`)
  const j = await r.json()
  if (j.error) throw new Error(j.error.errors?.[0]?.reason === 'quotaExceeded' ? 'YouTube’s daily limit for this site is used up. Try again tomorrow.' : j.error.message)
  return j as T
}

async function cached<T>(key: string, hours: number, load: () => Promise<T>): Promise<T> {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null') as { t: number; v: T } | null
    if (c && Date.now() - c.t < hours * 3600e3) return c.v
  } catch { /* no storage: just load */ }
  const v = await load()
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })) } catch { /* full or blocked */ }
  return v
}

function duration(iso = '') {
  const [, h = '0', m = '0', s = '0'] = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso) ?? []
  const mm = Number(h) ? String(m).padStart(2, '0') : String(Number(m))
  return iso === 'P0D' ? 'LIVE' : `${Number(h) ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
function views(n = '') {
  const v = Number(n)
  if (!n) return ''
  return `${v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v} views`.replace('.0', '')
}
function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? 's' : ''} ago` }
  }
  return 'just now'
}
const toVideo = (v: ApiVideo): Video => ({
  id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
  thumb: (v.snippet.thumbnails.medium ?? v.snippet.thumbnails.default).url,
  duration: duration(v.contentDetails?.duration), views: views(v.statistics?.viewCount), when: ago(v.snippet.publishedAt),
})

function popular() {
  if (!KEY) return Promise.resolve(FALLBACK)
  return cached(`yt:popular:${REGION}`, 0.5, async () => {
    const r = await api<{ items: ApiVideo[] }>('videos', { part: 'snippet,contentDetails,statistics,status', chart: 'mostPopular', regionCode: REGION, maxResults: String(COUNT) })
    return r.items.filter((v) => v.status?.embeddable !== false).map(toVideo)
  })
}
function search(q: string) {
  if (!KEY) return Promise.resolve(FALLBACK.filter((v) => v.title.toLowerCase().includes(q.toLowerCase())))
  return cached(`yt:search:${q.toLowerCase()}`, 24, async () => {
    const s = await api<{ items: { id: { videoId: string } }[] }>('search', { part: 'id', type: 'video', videoEmbeddable: 'true', safeSearch: 'moderate', maxResults: String(COUNT), q })
    const ids = s.items.map((i) => i.id.videoId).filter(Boolean)
    if (!ids.length) return []
    const r = await api<{ items: ApiVideo[] }>('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(',') })
    return r.items.map(toVideo)
  })
}

export function TVApp({ actions }: { actions: TVActions }) {
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('Popular in Lebanon')
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)

  const show = useCallback((label: string, load: Promise<Video[]>) => {
    setTitle(label); setLoading(true); setError('')
    load.then((v) => setVideos(v)).catch((e: Error) => setError(e.message)).finally(() => setLoading(false))
  }, [])
  const home = useCallback(() => { setQuery(''); show('Popular in Lebanon', popular()) }, [show])
  useEffect(home, [home])
  useEffect(() => { actions.browse = () => setPlaying(false) }, [actions])

  if (playing) return null // YouTube's player has the screen
  return (
    <div className="yt">
      <header>
        <button className="yt-logo" onClick={home} title="Home"><span className="yt-mark" />YouTube</button>
        <form onSubmit={(e) => { e.preventDefault(); const q = query.trim(); if (q) show(`Results for “${q}”`, search(q)) }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" spellCheck={false} />
          <button type="submit">Search</button>
        </form>
      </header>
      <h2>{title}</h2>
      {error && <p className="yt-note">{error}</p>}
      {loading && <p className="yt-note">Loading…</p>}
      {!loading && !error && !videos.length && <p className="yt-note">Nothing found.</p>}
      <div className="yt-grid">
        {videos.map((v) => (
          <button key={v.id} className="yt-card" onClick={() => { setPlaying(true); actions.play(videos.map((x) => x.id), videos.indexOf(v)) }}>
            <span className="yt-thumb"><img src={v.thumb} alt="" loading="lazy" />{v.duration && <span className="yt-dur">{v.duration}</span>}</span>
            <span className="yt-title">{v.title}</span>
            <span className="yt-meta">{v.channel}</span>
            {(v.views || v.when) && <span className="yt-meta">{[v.views, v.when].filter(Boolean).join(' · ')}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
