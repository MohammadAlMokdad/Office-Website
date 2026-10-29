// Step 8 check: open the built site in a real (headless) Chrome with the GPU, render the same eye-level views as
// blender/scripts/check_views.py, and report frame rate, draw calls, triangles and textures.
//   node check.mjs [url] [--tag web] [--size 1280x800] [--dpr 1] [--set issues|name,name] [--views file.json] [--params time=7:23]
// Screenshots: build/renders/web_<tag>_<i>.png    (start the app first: cd app && npm run preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'renders')
mkdirSync(OUT, { recursive: true })
const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const URL_ = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/'
const TAG = opt('--tag', 'web')
const [W, H] = opt('--size', '1280x800').split('x').map(Number)
const DPR = Number(opt('--dpr', '1'))
const EXTRA = opt('--params', '') // more URL switches, e.g. time=7:23
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// same as check_views.py (Blender coordinates; eye = floor + 1.62; 18 mm lens on a 36 mm sensor)
const FLOOR = -0.367, E = FLOOR + 1.62
const CLOSE = [
  [-1.75, -3.0, E, -1.75, -3.6, 0.40, 35],
  [-0.62, -3.0, E, -0.62, -3.62, 0.42, 35],
  [-0.35, -0.55, E, -1.18, -1.3, 0.25, 35],
  [1.0, 1.45, E, 1.62, 1.45, 0.55, 35],
]
const WIDE = [
  [-2.3, 1.6, E, 1.0, -2.0, E - 0.45, 18],
  [1.6, 1.4, E, -2.0, -2.6, E - 0.5, 18],
  [-0.6, -0.4, E, -0.6, 2.2, E - 0.25, 18],
  [-0.2, 1.0, E, -0.8, -4.3, E - 0.55, 18],
]

// --set issues: the named views in views.json (shared with blender/scripts/check_views.py --set)
const NAMED = JSON.parse(readFileSync(opt('--views', join(ROOT, 'tools', 'views.json')), 'utf8'))
const SET = opt('--set')
const VIEW_NAMES = SET ? Object.keys(NAMED).filter((k) => k !== '_' && (SET === 'issues' || SET.split(',').includes(k))) : null
const VIEWS = VIEW_NAMES ? VIEW_NAMES.map((k) => NAMED[k]) : args.includes('--close') ? CLOSE : WIDE
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-features=Vulkan', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400) logs.push(`error: HTTP ${r.status()} ${r.url()}`) })

async function settle() {
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5, null, { timeout: 180000 })
  await page.waitForFunction(() => (window.__office?.frames ?? 0) > 120, null, { timeout: 180000 })
  await page.waitForTimeout(2500) // let the frame-rate average settle
  return page.evaluate(() => window.__office)
}

const gpu = await (async () => {
  await page.goto('about:blank')
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
})()
console.log('GPU:', gpu)

const results = []
for (const [i, v] of VIEWS.entries()) {
  const t = Date.now()
  await page.goto(`${URL_}?debug&noui&view=${v.join(',')}${EXTRA ? '&' + EXTRA : ''}`)
  const s = await settle()
  const file = join(OUT, `web_${TAG}_${VIEW_NAMES ? VIEW_NAMES[i] : i}.png`)
  await page.screenshot({ path: file })
  results.push({ view: i, ...s, loadSeconds: (Date.now() - t) / 1000 })
  console.log(`view ${i}: ${s.fps.toFixed(0)} fps, ${s.calls} draw calls, ${(s.triangles / 1000).toFixed(0)}k triangles, ${s.textures} textures, ${s.programs} shaders  -> ${file}`)
}
writeFileSync(join(OUT, `web_${TAG}.json`), JSON.stringify({ gpu, size: [W, H], dpr: DPR, results, logs }, null, 1))
const errors = logs.filter((l) => /error|warn/i.test(l))
if (errors.length) console.log('console:\n  ' + errors.slice(0, 20).join('\n  '))
await browser.close()
