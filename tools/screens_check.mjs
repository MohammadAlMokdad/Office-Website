// Screens check: Ali's monitor with its video, the wall screen off and switched on (through the debug hook of
// interact.ts); then walking: Ali's screen label, E flies up to it, Esc back; the intercom label, E switches it on.
// Screenshots: build/renders/scr_ali.png, scr_wall_off.png, scr_wall_on.png, scr_ali_label.png, scr_ali_close.png,
// scr_intercom.png
//   node screens_check.mjs      (start the app first: cd app && npm run preview)
import { chromium } from 'playwright-core'
const APP = process.env.APP ?? 'http://localhost:4173' // the app (APP=http://localhost:<port> for another server)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const logs = []; page.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text()) }); page.on('pageerror', (e) => logs.push(e.message))
const shot = async (view, file, before) => {
  await page.goto(`${APP}/?debug&noui&view=${view.join(',')}`)
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5 && (window.__office?.frames ?? 0) > 120, null, { timeout: 180000 })
  if (before) await page.evaluate(before)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `../build/renders/${file}` })
}
await shot([-2.55, -3.585, 0.80, -1.45, -3.585, 0.73, 28], 'scr_ali.png')

await shot([-2.35, -1.026, 1.32, -2.837, -1.026, 1.313, 35], 'scr_wall_off.png')
await shot([-2.35, -1.026, 1.32, -2.837, -1.026, 1.313, 35], 'scr_wall_on.png', () => { const u = window.__usables; console.log('usables', u.length, u.map((x) => x.label()).join(', ')); u.find((x) => x.label() === 'Intercom').use() })

// walking: the labels and E
const ui = () => page.evaluate(() => ({
  label: document.querySelector('.prompt.on')?.textContent ?? null,
  corner: [...document.querySelectorAll('.back-to-walking, .use-hint')].map((h) => h.textContent).join(' + ') || null,
  locked: !!document.pointerLockElement,
  camera: window.__three.camera.position.toArray().map((v) => +v.toFixed(2)).join(', '),
}))
const enter = async (url) => {
  await page.goto(url)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
}
await enter(`${APP}/?debug&cam=-2.9,-3.0,-1.63,-3.585,0.747`)
console.log('by Ali\'s desk, turned to his screen:', await ui())
await page.screenshot({ path: '../build/renders/scr_ali_label.png' })
await page.keyboard.press('KeyE'); await page.waitForTimeout(1500)
console.log('E:', await ui())
await page.screenshot({ path: '../build/renders/scr_ali_close.png' })
await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
console.log('Esc:', await ui())
await enter(`${APP}/?debug&cam=-2.0,-1.03,-2.837,-1.026,1.313`)
console.log('turned to the intercom:', await ui())
await page.keyboard.press('KeyE'); await page.waitForTimeout(800)
console.log('E:', await ui())
await page.screenshot({ path: '../build/renders/scr_intercom.png' })
console.log(logs.filter((l) => !/X4122|THREE\.Clock/.test(l)).slice(0, 10).join('\n'))
await browser.close()
