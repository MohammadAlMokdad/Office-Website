// What is under some pixels of a named view (debugging the baked look): mesh, face, UV and the Blender-space point.
//   node pick.mjs <view name in views.json> <W>x<H> x,y [x,y ...]
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const [name, size, ...pts] = process.argv.slice(2)
const v = JSON.parse(readFileSync(new URL('./views.json', import.meta.url), 'utf8'))[name]
const [W, H] = size.split('x').map(Number)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(`http://localhost:4173/?debug&noui&view=${v.join(',')}`)
await page.waitForFunction(() => (window.__office?.frames ?? 0) > 120, null, { timeout: 180000 })
await page.waitForTimeout(1000)
for (const p of pts) {
  const [x, y] = p.split(',').map(Number)
  const h = await page.evaluate(([a, b]) => window.__pick(a, b), [x, y])
  console.log(p, h.slice(0, 3).map((q) => `${q.name} f${q.face} uv(${q.uv.map((u) => u.toFixed(4))}) d${q.distance.toFixed(3)} p(${q.blender.map((u) => u.toFixed(4))})`).join('  ||  '))
}
await browser.close()
