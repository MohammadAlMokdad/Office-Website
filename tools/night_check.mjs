// Night check: the room with the blinds closed. Fixed views (the whole room from the entrance side, the round table
// and the floor under it where the sun patch is, the South window) in four states: everything on (the bake), the
// blackout blinds down with the lamps on, the same with the lamps off, the sheer blinds down. The pictures are for
// looking at (the cave, the sun patch, the grey sheer blinds); the numbers say how dark each state is (mean canvas
// brightness) and what lighting.ts chose (the lamps' gain, the exposure).
// Screenshots: build/renders/night_<view>_<state>.png
//   node night_check.mjs [--gain 6 --adapt 0.5 --adaptMax 2.5]   (start the app first; APP=http://localhost:4197 by default)
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'renders')
mkdirSync(OUT, { recursive: true })
const APP = (process.env.APP ?? 'http://localhost:4197').replace(/\/$/, '')
const args = process.argv.slice(2)
const opt = (n) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : undefined)
const tune = Object.fromEntries(['gain', 'adapt', 'adaptMax'].map((k) => [k, opt(`--${k}`)]).filter(([, v]) => v !== undefined))
const scene = JSON.parse(readFileSync(join(ROOT, 'app', 'src', 'data', 'scene.json'), 'utf8'))
const FLOOR = scene.floor, E = FLOOR + scene.eye
console.log(`lightGroups: ${scene.lightGroups?.names?.join(' ')} (${scene.lightGroups?.encoding ?? 'linear'}), probe ${JSON.stringify(scene.lightGroups?.probe)}`)

// Blender coordinates [x, y, z, target x, y, z, lens]; three.js (x, y, z) -> Blender (x, -z, y)
const table = scene.seats?.find((s) => /round table/i.test(s.label))?.look ?? [-0.4, 0.75, 1.1]
const tb = [table[0], -table[2], table[1]]
const mid = [-0.4, -1.09] // the room's middle (Blender x, y)
const d = [mid[0] - tb[0], mid[1] - tb[1]], len = Math.hypot(...d) || 1
const VIEWS = {
  room: [-2.3, 1.6, E, 1.0, -2.0, E - 0.45, 18], // from the entrance side towards the windows
  room2: [1.6, 1.4, E, -2.0, -2.6, E - 0.5, 18],
  table: [tb[0] + (d[0] / len) * 1.5, tb[1] + (d[1] / len) * 1.5, E + 0.1, tb[0], tb[1], FLOOR + 0.3, 24], // the table top and the floor under it
  south: [-1.487, -1.9, E, -1.487, -4.475, 1.47, 18], // the South window
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const logs = []; page.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text()) }); page.on('pageerror', (e) => logs.push(e.message))
const settle = async () => {
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5 && (window.__office?.frames ?? 0) > 120 && !!window.__blinds && !!window.__lights, null, { timeout: 180000 })
  await page.waitForTimeout(2000)
}
const brightness = () => page.evaluate(() => {
  const c = document.querySelector('canvas'), o = document.createElement('canvas')
  o.width = c.width; o.height = c.height
  const ctx = o.getContext('2d'); ctx.drawImage(c, 0, 0)
  const d = ctx.getImageData(0, 0, o.width, o.height).data
  let s = 0
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3
  return +(s / (d.length / 4)).toFixed(1)
})
const info = () => page.evaluate(() => {
  const t = window.__lighting.tuned(), b = window.__blinds.state()
  return `gain ${t.gain_now.toFixed(2)}, level ${t.level.toFixed(3)}, exposure ${t.exposure.toFixed(2)}, windows ${Object.values(b.windows).map((v) => v.toFixed(2)).join('/')}, sun ${b.sun.toFixed(2)}`
})
const lamps = (on) => page.evaluate((on) => { for (const s of window.__lights.state()) if (s.on !== on) window.__lights.toggle(Number(s.lamp.slice(-1))) }, on)
const blinds = async (kind, down) => { await page.evaluate(([k, d]) => window.__blinds.set(k, d), [kind, down]); await page.waitForTimeout(4500) }
const shot = async (view, state) => {
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, `night_${view}_${state}.png`) })
  console.log(`  ${state.padEnd(9)} brightness ${String(await brightness()).padStart(5)}  ${await info()}`)
}

for (const [view, v] of Object.entries(VIEWS)) {
  await page.goto(`${APP}/?debug&noui&view=${v.map((x) => +x.toFixed(3)).join(',')}`)
  await settle()
  if (Object.keys(tune).length) await page.evaluate((t) => window.__lighting.tune(t), tune)
  console.log(`${view}: tune ${JSON.stringify(await page.evaluate(() => { const t = window.__lighting.tuned(); return { gain: t.gain, adapt: t.adapt, adaptMax: t.adaptMax } }))}`)
  await shot(view, 'day')
  await blinds('dark', true)
  await shot(view, 'dark_on')
  await lamps(false); await page.waitForTimeout(500)
  await shot(view, 'dark_off')
  await lamps(true); await blinds('dark', false); await blinds('light', true)
  await shot(view, 'sheer')
}
const noise = logs.filter((l) => !/X4122|THREE\.Clock|AudioContext was not allowed/.test(l))
if (noise.length) console.log('console:', noise.slice(0, 10).join('\n'))
await browser.close()
