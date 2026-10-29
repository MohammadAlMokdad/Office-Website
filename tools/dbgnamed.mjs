// Debug channels for one named view: node dbgnamed.mjs <view> <tag>
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const OUT = join(ROOT, 'build', 'renders')
const v = JSON.parse(readFileSync(join(ROOT, 'tools', 'views.json'), 'utf8'))[process.argv[2]]; const tag = process.argv[3]
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
for (const d of ['base', 'f0', 'rough', 'occ', 'spec']) {
  await page.goto(`http://localhost:4173/?debug&noui&dbg=${d}&view=${v.join(',')}`)
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5, null, { timeout: 120000 }); await page.waitForTimeout(1200)
  await page.screenshot({ path: join(OUT, `${tag}_${d}.png`) })
}
await browser.close()
