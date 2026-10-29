// TV check: the labelled remotes by the recliner; turned to the TV, its label shows; E turns it on and the camera flies
// up to it (the YouTube app: search, pick a video, YouTube's player); Esc flies back; E there switches it off. On the
// recliner: sit, E on the TV, Esc back to the seat, S stands up. A run uses ~101 units of the YouTube Data API quota
// (one search). Screenshots: build/renders/tv_*.png
//   node tv_check.mjs      (start the app first: cd app && npm run preview; needs the internet)
import { chromium } from 'playwright-core'
const APP = process.env.APP ?? 'http://localhost:4173' // the app (APP=http://localhost:<port> for another server)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const ui = () => page.evaluate(() => ({
  label: document.querySelector('.prompt.on')?.textContent ?? null,
  corner: [...document.querySelectorAll('.back-to-walking, .use-hint')].map((h) => h.textContent).join(' + ') || null,
  keys: document.querySelector('.shortcuts')?.textContent ?? null,
  remotes: [...document.querySelectorAll('.callout')].filter((c) => c.style.display !== 'none').map((c) => c.textContent),
  locked: !!document.pointerLockElement,
}))
const app = () => page.evaluate(() => ({
  heading: document.querySelector('.yt h2')?.textContent ?? null,
  note: document.querySelector('.yt-note')?.textContent ?? null,
  cards: document.querySelectorAll('.yt-card').length,
  first: document.querySelector('.yt-card .yt-title')?.textContent ?? null,
}))
const state = () => page.evaluate(() => ({ on: window.__tv.on, soundbar: window.__tv.soundbar, using: window.__tv.page.using, volume: window.__tv.volume, player: window.__tv.player?.getPlayerState?.() ?? null }))
const cam = () => page.evaluate(() => window.__three.camera.position.toArray().map((v) => +v.toFixed(2)).join(', '))
const centre = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }, sel)
const enter = async (url) => {
  await page.goto(url)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
}

// 1. by the recliner: the remotes are tagged
await enter(`${APP}/?debug&cam=-0.3,-0.75,-1.18,-1.30,0.2`)
console.log('by the recliner:', await ui())
await page.screenshot({ path: '../build/renders/tv_labels.png' })

// 2. in the room, turned to the TV: its label; a left click does nothing; E: on, and the camera flies up to it
await enter(`${APP}/?debug&cam=-0.4,-0.6,-0.395,2.14,0.75`)
const camBefore = await cam()
console.log('turned to the TV:', await ui(), 'camera', camBefore)
await page.screenshot({ path: '../build/renders/tv_label.png' })
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(800) // a click without moving the mouse (that would turn the view)
console.log('left click does nothing:', await state())
await page.keyboard.press('KeyE'); await page.waitForTimeout(4000)
console.log('E (TV on, flown up to it):', await ui(), await app(), 'camera', await cam())
await page.screenshot({ path: '../build/renders/tv_home.png' })
const [ix, iy] = await centre('.yt input')
await page.mouse.click(ix, iy); await page.keyboard.type('blender the beat open movie'); await page.keyboard.press('Enter')
await page.waitForTimeout(4000)
console.log('search:', await app(), await state())
await page.screenshot({ path: '../build/renders/tv_search.png' })
const yt = () => page.evaluate(() => { const p = window.__tv.player; return p ? { state: p.getPlayerState(), index: p.getPlaylistIndex(), count: p.getPlaylist()?.length ?? 0, title: p.getVideoData?.().title } : null })
const [cx, cy] = await centre('.yt-card')
await page.mouse.click(cx, cy); await page.waitForTimeout(7000)
console.log('picked the first video:', await yt(), await ui())
const tvMid = await page.evaluate(() => { const r = window.__tv.page.el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
await page.mouse.move(tvMid[0], tvMid[1] + 20); await page.waitForTimeout(500)
await page.screenshot({ path: '../build/renders/tv_video.png' })
await page.mouse.click(tvMid[0], tvMid[1] + 20); await page.waitForTimeout(1500)
console.log('click on the player:', await yt(), 'keyboard with the page:', await page.evaluate(() => !(document.activeElement instanceof HTMLIFrameElement)))
await page.mouse.click(tvMid[0], tvMid[1] + 20); await page.waitForTimeout(1200)

// 3. WASD do nothing up close (one view); Esc: flown back, walking; E: up to it again; E there: TV off, back
await page.keyboard.press('KeyA'); await page.waitForTimeout(600)
console.log('A up close:', (await ui()).corner, (await state()).using)
await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
console.log('Esc:', await ui(), await state(), 'camera', await cam(), '(was', camBefore + ')')
await page.keyboard.press('KeyE'); await page.waitForTimeout(1200)
console.log('E on the TV again:', (await ui()).keys)
await page.keyboard.press('KeyE'); await page.waitForTimeout(1500)
console.log('E there (TV off):', await ui(), await state(), 'camera', await cam())

// 4. on the recliner: sit, E on the TV (on, up to it), Esc back to the seat, S stands up
await enter(`${APP}/?debug&cam=-0.3,-0.75,-1.18,-1.30,0.2`)
await page.keyboard.press('KeyE'); await page.waitForTimeout(1200)
console.log('seated:', await ui())
await page.evaluate(() => window.__three.camera.lookAt(-0.395, 0.746, -2.143)); await page.waitForTimeout(400)
const seat = await cam()
console.log('seated, turned to the TV:', await ui())
await page.screenshot({ path: '../build/renders/tv_seated.png' })
await page.keyboard.press('KeyE'); await page.waitForTimeout(2500)
console.log('E:', await ui(), 'camera', await cam())
await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
console.log('Esc:', await ui(), 'camera', await cam(), '(seat', seat + ')')
await page.keyboard.press('KeyS'); await page.waitForTimeout(1500)
console.log('S:', await ui(), 'camera', await cam())
if (errors.length) console.log('errors:', errors)
await browser.close()
