// Screenshots of one view in every debug channel: node dbgviews.mjs <view index> <tag>
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'build', 'renders')
const FLOOR = -0.367, E = FLOOR + 1.62
const VIEWS = [[-2.3, 1.6, E, 1.0, -2.0, E - 0.45, 18], [1.6, 1.4, E, -2.0, -2.6, E - 0.5, 18], [-0.6, -0.4, E, -0.6, 2.2, E - 0.25, 18], [-0.2, 1.0, E, -0.8, -4.3, E - 0.55, 18]]
const v = VIEWS[Number(process.argv[2] ?? 1)], tag = process.argv[3] ?? 'dbg'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
for (const d of ['occ', 'f0', 'rough', 'spec', 'base']) {
  await page.goto(`http://localhost:4173/?debug&noui&dbg=${d}&view=${v.join(',')}`)
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5, null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(OUT, `${tag}_${d}.png`) })
}
await browser.close()
