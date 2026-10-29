// Sound effects check (app/src/sfx.ts): in a headless Chrome that allows audio without a gesture, enter the office
// and count what plays (window.__sfx.played, ?debug): footsteps while walking, the light switch, the blinds' button
// and end stop (after the motors), sitting down and up, the TV, the soundbar, M muting and unmuting, settling at the
// laptop and up again (the window's close button), the keys and the mouse on its page, that E on the TV and the
// pause screen make no chair / UI sounds, and that every recording loaded. (Headless Chrome often refuses to lock the mouse again after a flight back: the pause screen
// then shows by itself, which is where its M line is read.)
//   node sfx_check.mjs      (start the app first; APP=http://localhost:4197 by default)
import { chromium } from 'playwright-core'

const APP = (process.env.APP ?? 'http://localhost:4197').replace(/\/$/, '')
const RECORDINGS = 23 // the files public/sfx holds (sfx.ts SOUNDS)
let failed = 0
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`); if (!ok) failed++ }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const logs = []; page.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text()) }); page.on('pageerror', (e) => logs.push(e.message)); page.on('response', (r) => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`) })
const played = () => page.evaluate(() => ({ ...window.__sfx.played }))
const n = (p, k) => p[k] ?? 0
const seated = () => page.evaluate(() => !!document.querySelector('.back-to-walking'))
const clickEnter = async () => {
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
}
const enter = async (url) => {
  await page.goto(url)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  await clickEnter()
}

// by the light switches, facing the wall
await enter(`${APP}/?debug&cam=-2.05,1.5,-2.05,2.2,0.78`)
await page.waitForTimeout(800)
check('the enter button makes no sound and the sound is on', n(await played(), 'enter') === 0 && n(await played(), 'menu_open') === 0 && (await page.evaluate(() => window.__sfx.sfx.muted() === false)), JSON.stringify(await played()))
const loaded = await page.evaluate(() => window.__sfx.sfx.loaded())
check('every recording loaded', loaded === RECORDINGS, `${loaded} of ${RECORDINGS}`)
let before = await played()
await page.keyboard.down('KeyS'); await page.waitForTimeout(2200); await page.keyboard.up('KeyS'); await page.waitForTimeout(300)
let after = await played()
const steps = n(after, 'step') - n(before, 'step')
check('footsteps while walking (1.4 m/s, a step every 0.72 m)', steps >= 3 && steps <= 6, `${steps} steps in 2.2 s`)
before = after
await page.waitForTimeout(600)
check('no footsteps standing still', n(await played(), 'step') === n(before, 'step'))
await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW'); await page.waitForTimeout(500)
before = await played()
await page.keyboard.press('KeyE'); await page.waitForTimeout(400)
after = await played()
check('E on a light switch clicks the rocker', n(after, 'switch') === n(before, 'switch') + 1, `${n(before, 'switch')} -> ${n(after, 'switch')} (label: ${await page.evaluate(() => document.querySelector('.prompt.on')?.textContent ?? null)})`)
await page.keyboard.press('KeyE'); await page.waitForTimeout(300)

// the blinds: the remote's button, the motor, the end stop
await enter(`${APP}/?debug&cam=-1.3,-2.0,-0.96,-2.3,0.1`)
await page.waitForTimeout(800)
before = await played()
await page.keyboard.press('Digit1'); await page.waitForTimeout(600)
after = await played()
check("the blinds' remote clicks", n(after, 'button') === n(before, 'button') + 1, `${n(before, 'button')} -> ${n(after, 'button')}`)
check('no end stop yet (the motors run 3.5 s)', n(after, 'clunk') === n(before, 'clunk'))
check('a motor runs at each of the 3 windows meanwhile (the recording)', (await page.evaluate(() => window.__sfx.motors())) === 3, `${await page.evaluate(() => window.__sfx.motors())} running`)
await page.waitForTimeout(3600)
after = await played()
check('the end stop at each of the 3 windows when the blinds are down', n(after, 'clunk') === n(before, 'clunk') + 3, `${n(after, 'clunk')}`)
check('the motors stopped', (await page.evaluate(() => window.__sfx.motors())) === 0)
await page.keyboard.press('Digit1'); await page.waitForTimeout(4200)

// the recliner: sit (cloth, the chair), Esc (up: the chair, cloth)
await enter(`${APP}/?debug&cam=-0.35,-0.55,-1.18,-1.3,0.25`)
await page.waitForTimeout(800)
before = await played()
const label = await page.evaluate(() => document.querySelector('.prompt.on')?.textContent ?? null)
await page.keyboard.press('KeyE'); await page.waitForTimeout(1200)
after = await played()
check('sitting down: cloth and the chair', n(after, 'cloth') === n(before, 'cloth') + 1 && n(after, 'creak') === n(before, 'creak') + 1 && (await seated()), `label ${label}: cloth ${after.cloth}, creak ${after.creak}, seated ${await seated()}`)
before = after
await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(1500) // (a synthetic Esc does not release the lock in headless Chrome: this is what Esc does)
after = await played()
check('Esc up from the seat: the chair and cloth again', n(after, 'creak') === n(before, 'creak') + 1 && n(after, 'cloth') === n(before, 'cloth') + 1 && !(await seated()), `creak ${n(before, 'creak')} -> ${n(after, 'creak')}, cloth ${n(before, 'cloth')} -> ${n(after, 'cloth')}, seated ${await seated()}`)

// the TV from the recliner: T (TV on), B (soundbar), M (mute), M (unmute), T (off)
await enter(`${APP}/?debug&cam=-0.35,-0.55,-1.18,-1.3,0.25`)
await page.waitForTimeout(800)
await page.keyboard.press('KeyE'); await page.waitForTimeout(1200)
before = await played()
await page.keyboard.press('KeyT'); await page.waitForTimeout(1500)
after = await played()
check('T: the TV comes on (its button, its sound)', n(after, 'tv_on') === n(before, 'tv_on') + 1 && n(after, 'button') === n(before, 'button') + 1, `tv_on ${after.tv_on}, button ${after.button}`)
// E on the TV from the recliner: in close (you watch from the recliner: no chair, no cloth); E again: off and back
before = after
await page.keyboard.press('KeyE'); await page.waitForTimeout(1600)
after = await played()
check('E on the TV: in close, with no chair or cloth', n(after, 'cloth') === n(before, 'cloth') && n(after, 'creak') === n(before, 'creak') && n(after, 'tv_on') === n(before, 'tv_on') && (await page.evaluate(() => window.__inspect.get().looking?.name ?? null)) === 'tv', `cloth ${n(before, 'cloth')} -> ${n(after, 'cloth')}, creak ${n(before, 'creak')} -> ${n(after, 'creak')}, looking ${await page.evaluate(() => window.__inspect.get().looking?.name ?? null)}`)
before = after
await page.keyboard.press('KeyE'); await page.waitForTimeout(1500)
after = await played()
check('E again: the TV off and back to the recliner, no chair or cloth', n(after, 'tv_off') === n(before, 'tv_off') + 1 && n(after, 'cloth') === n(before, 'cloth') && n(after, 'creak') === n(before, 'creak') && (await page.evaluate(() => window.__inspect.get().looking)) === null, `tv_off ${n(before, 'tv_off')} -> ${n(after, 'tv_off')}`)
before = after
await page.keyboard.press('KeyT'); await page.waitForTimeout(1200)
after = await played()
check('T: on again', n(after, 'tv_on') === n(before, 'tv_on') + 1)
before = after
await page.keyboard.press('KeyB'); await page.waitForTimeout(400)
after = await played()
check('B: the soundbar toggles', n(after, 'toggle') === n(before, 'toggle') + 1)
const muted = () => page.evaluate(() => window.__sfx.sfx.muted())
await page.keyboard.press('KeyM'); await page.waitForTimeout(300)
check('M mutes (and remembers it)', (await muted()) && (await page.evaluate(() => localStorage.getItem('office-sound'))) === 'off')
await page.waitForTimeout(400)
const tvVolume = await page.evaluate(() => window.__tv?.volume ?? null)
check('the TV is quiet while muted (-1: no player in this Chrome)', tvVolume === null || tvVolume <= 0, `${tvVolume}`)
await page.keyboard.press('KeyM'); await page.waitForTimeout(300)
check('M again unmutes', !(await muted()))
before = await played()
await page.keyboard.press('KeyT'); await page.waitForTimeout(800)
check('T again: the TV goes off', n(await played(), 'tv_off') === n(before, 'tv_off') + 1)

// the laptop: fly in, the mouse and the keys on its page, the window's close button (fly out); then the pause screen
await enter(`${APP}/?debug&cam=0.5,-0.1,1.75,-0.09,0.55`)
await page.waitForTimeout(800)
before = await played()
await page.keyboard.press('KeyE'); await page.waitForTimeout(1600)
after = await played()
check('E flies to the laptop: cloth and the chair (settling at the desk)', n(after, 'cloth') === n(before, 'cloth') + 1 && n(after, 'creak') === n(before, 'creak') + 1)
const box = await page.evaluate(() => { const r = window.__laptops.mhmd.el.querySelector('.cm-content').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 30] })
await page.mouse.click(box[0], box[1]); await page.waitForTimeout(200)
before = await played()
await page.keyboard.type('hey', { delay: 60 }); await page.waitForTimeout(300)
after = await played()
check('typing on the laptop ticks (3 keys)', n(after, 'key') === n(before, 'key') + 3, `${n(before, 'key')} -> ${n(after, 'key')}`)
check('the click on the page was heard', n(before, 'mouse_down') >= 1 && n(before, 'mouse_up') >= 1, `down ${before.mouse_down}, up ${before.mouse_up}`)
before = after
const x = await page.evaluate(() => { const r = window.__laptops.mhmd.el.querySelector('.vsc-window-controls .close').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
await page.mouse.click(x[0], x[1]); await page.waitForTimeout(1500)
after = await played()
check("the window's close button flies out: the chair and cloth", n(after, 'creak') === n(before, 'creak') + 1 && n(after, 'cloth') === n(before, 'cloth') + 1 && (await page.evaluate(() => window.__inspect.get().looking)) === null)
// the pause screen is silent (nothing in real life makes a sound there); it lists M
await page.waitForTimeout(1500)
if (await page.evaluate(() => !!document.pointerLockElement)) await page.evaluate(() => document.exitPointerLock())
await page.waitForTimeout(1200)
check('the pause screen is up and silent', (await page.isVisible('.screen .keys')) && n(await played(), 'menu_open') === 0 && n(await played(), 'menu_close') === 0)
const m = await page.evaluate(() => [...document.querySelectorAll('.keys li')].map((l) => l.textContent).find((t) => /^M\b/.test(t)) ?? null)
check('the pause screen lists M', !!m && /sound/.test(m), m)

const noise = logs.filter((l) => !/X4122|THREE\.Clock|AudioContext was not allowed|Measure loop/.test(l))
check('no errors, no missing files', !noise.length, noise.slice(0, 5).join(' | '))
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
