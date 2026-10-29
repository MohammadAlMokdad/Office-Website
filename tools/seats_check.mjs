// Seats check: stand near a chair, turn its way (its label shows), E to sit (screenshot); the mouse looks around there
// and W does nothing; Esc stands you up and you walk on at once (no pause menu, no cursor), the mouse locked again at
// the next key press. Headless Chrome does not let go of the mouse at Esc the way Chrome does: the check lets go of it.
// Screenshots: build/renders/seat_<name>.png      (start the app first: cd app && npm run preview)
//   node seats_check.mjs
import { chromium } from 'playwright-core'
const APP = process.env.APP ?? 'http://localhost:4173' // the app (APP=http://localhost:<port> for another server)
// [name, standing plan position x, y, chair x, y (Blender), look height]
const TESTS = [
  ['ali', -2.55, -2.75, -2.24, -3.58, 0.2], // Ali's desk: one E for his screen, no sitting
  ['mhmd', 0.35, -0.4, 1.09, -0.09, 0.25], // Mhmd's desk: one E for his laptop, no sitting
  ['recliner', -0.45, -1.0, -1.18, -1.30, 0.1],
  ['round_table', 0.35, -1.7, 1.07, -2.14, 0.25],
  ['ali_far', -2.4, -1.4, -2.24, -3.58, 0.2], // too far to sit: no label, E does nothing
]
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const state = () => page.evaluate(() => {
  const cam = window.__three.camera, d = new cam.position.constructor()
  cam.getWorldDirection(d)
  return [
    document.querySelector('.prompt.on')?.textContent,
    ...[...document.querySelectorAll('.back-to-walking, .shortcuts')].map((h) => `${h.textContent} [corner]`),
    document.querySelector('.card') && 'MENU', document.querySelector('.relock') && 'no cursor',
    document.pointerLockElement ? 'locked' : 'unlocked',
    `camera ${cam.position.toArray().map((v) => v.toFixed(2)).join(', ')} yaw ${(Math.atan2(d.x, d.z) * 180 / Math.PI).toFixed(0)}`,
  ].filter(Boolean).join(' + ')
})
for (const [name, x, y, cx, cy, lz] of TESTS) {
  await page.goto(`${APP}/?debug&cam=${x},${y},${cx},${cy},${lz}`)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 })
  await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
  const log = [`walking: ${await state()}`]
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1200)
  log.push(`E: ${await state()}`)
  await page.screenshot({ path: `../build/renders/seat_${name}.png` })
  await page.mouse.move(480, 270); await page.mouse.move(600, 270, { steps: 5 }); await page.waitForTimeout(200)
  log.push(`mouse: ${await state()}`)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW'); await page.waitForTimeout(500)
  log.push(`W: ${await state()}`)
  if (name !== 'ali' && name !== 'mhmd') { // (at a desk the mouse is free already: a real Esc reaches the page, inspect.ts)
    await page.evaluate(() => document.exitPointerLock()) // Chrome at Esc
    await page.waitForTimeout(300); log.push(`Esc +300 ms: ${await state()}`)
    await page.waitForTimeout(900); log.push(`Esc +1200 ms: ${await state()}`)
    await page.mouse.move(610, 270); await page.mouse.move(730, 270, { steps: 5 }); await page.waitForTimeout(200) // (the first move counts the one seated: dropped)
    log.push(`mouse: ${await state()}`)
  } else {
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500); log.push(`Esc +1500 ms: ${await state()}`)
  }
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW'); await page.waitForTimeout(400)
  log.push(`W: ${await state()}`)
  console.log(name, log)
}
if (errors.length) console.log('errors:', errors)
await browser.close()
