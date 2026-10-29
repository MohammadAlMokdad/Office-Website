// Laptop desks check: Mhmd's and Zuhair's desks, VS Code on their laptops (LaptopDesk.tsx). By a desk, turned to its
// laptop, one label (MHMD'S DESK / ZUHAIR'S DESK); E: the camera flies up to the laptop's screen (one view: no arrows);
// a click in the editor and W A S D type there (the view stays; without the editor yet, the stub, they do nothing);
// Esc: back to walking within 2 s, no pause menu, the mouse locked again, and the keys walk again. Then Mhmd's chair: no
// Sit label (one E per desk). Exit code 1 if a check failed.
// Screenshots: build/renders/laptop_mhmd.png, laptop_zuhair.png, laptop_chair.png
//   node laptop_check.mjs      (start the app first: cd app && npx vite --port 4185 --strictPort;
//                               APP=http://localhost:<port> if it is elsewhere)
import { chromium } from 'playwright-core'
const APP = process.env.APP ?? 'http://localhost:4185'
const DESKS = [ // laptop, its label, ?cam= by the desk, turned to the laptop
  ['mhmd', 'Mhmd’s desk', '0.5,-0.1,1.75,-0.09,0.55'],
  ['zuhair', 'Zuhair’s desk', '0.5,1.45,1.75,1.45,0.55'],
]
const CHAIR = '0.35,-0.4,1.09,-0.09,0.25' // by Mhmd's chair, turned to it (seats_check.mjs)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
let failed = 0
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
// what is on screen: the label, the view (inspect.ts), the corners, the menu, the mouse, the camera, and where the camera
// is relative to the laptop's screen (from the desk's usable: `front` m in front of the glass, `off` m from its middle)
const ui = (laptop, label) => page.evaluate(([laptop, label]) => {
  const look = window.__inspect.get().looking, cam = window.__three.camera
  const u = window.__usables.find((x) => x.label() === label), d = u && cam.position.clone().sub(u.at)
  const front = d && d.dot(u.facing)
  return {
    label: document.querySelector('.prompt.on b')?.textContent ?? null,
    pill: document.querySelector('.prompt.on')?.textContent ?? null,
    looking: look ? `${look.name} ${look.index + 1}/${look.views}` : null,
    using: window.__laptops?.[laptop]?.using ?? null,
    corner: [...document.querySelectorAll('.back-to-walking')].map((h) => h.textContent).join(' + ') || null,
    arrows: document.querySelectorAll('.browse-arrow').length,
    menu: !!document.querySelector('.card'),
    locked: !!document.pointerLockElement,
    camera: cam.position.toArray().map((v) => +v.toFixed(3)).join(', '),
    front: d ? +front.toFixed(3) : null,
    off: d ? +Math.sqrt(Math.max(0, d.lengthSq() - front * front)).toFixed(3) : null,
  }
}, [laptop, label])
const enter = async (cam) => {
  await page.goto(`${APP}/?debug&cam=${cam}`)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
  await page.waitForFunction(() => window.__laptops && Object.keys(window.__laptops).length === 2, null, { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(600)
}
// the editor on this laptop's page (VS Code's CodeMirror editor), if the shell is there: its middle on screen
const editorAt = (laptop) => page.evaluate((l) => {
  const e = window.__laptops?.[l]?.el.querySelector('.cm-content')
  if (!e) return null
  const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, laptop)

for (const [laptop, label, cam] of DESKS) {
  console.log(`${label} (laptop_${laptop}):`)
  await enter(cam)
  let s = await ui(laptop, label)
  console.log('  by the desk:', s)
  check(s.label === label, `the label reads ${JSON.stringify(s.label)} (drawn in capitals: ${label.toUpperCase()})`)
  check(s.locked && !s.looking, 'walking, the mouse locked')
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1500)
  s = await ui(laptop, label)
  console.log('  E + 1.5 s:', s)
  check(s.looking === `laptop_${laptop} 1/1`, `looking at laptop_${laptop}, one view`)
  check(s.front > 0.03 && s.off < 0.05, `the camera is in front of the screen: ${s.front} m out from the glass, ${s.off} m off its middle`)
  check(s.arrows === 0 && !s.menu && !s.locked && s.using === true && /Back to walking/.test(s.corner ?? ''), 'no arrows, no menu, the mouse free, the page in use, "Back to walking (Esc)" in the corner')
  await page.screenshot({ path: `../build/renders/laptop_${laptop}.png` })
  // typing: W A S D in the editor type there, the view stays
  const before = s.camera
  const at = await editorAt(laptop)
  if (at) {
    await page.mouse.click(at[0], at[1]); await page.waitForTimeout(300)
    const focused = await page.evaluate((l) => document.activeElement === window.__laptops[l].el.querySelector('.cm-content'), laptop)
    await page.keyboard.type('wasd'); await page.waitForTimeout(400)
    const text = await page.evaluate((l) => window.__laptops[l].el.querySelector('.cm-content').textContent, laptop)
    s = await ui(laptop, label)
    console.log(`  editor case: clicked in .cm-content (focused: ${focused}), typed wasd:`, s)
    check(focused, 'the click put the keyboard in the editor')
    check(text.includes('wasd'), `the typed text landed in the editor (${JSON.stringify(text.slice(Math.max(0, text.indexOf('wasd') - 20), text.indexOf('wasd') + 24))})`)
    check(s.looking === `laptop_${laptop} 1/1` && s.camera === before, 'the view did not change')
  } else {
    await page.keyboard.type('wasd'); await page.waitForTimeout(400)
    s = await ui(laptop, label)
    console.log('  stub case (no .cm-content on this laptop yet): typed wasd into nothing:', s)
    check(s.looking === `laptop_${laptop} 1/1` && s.camera === before, 'the view did not change')
  }
  await page.keyboard.press('Escape')
  let elapsed = 0, menu = false, last = null
  for (const t of [300, 900, 1500, 2000]) {
    await page.waitForTimeout(t - elapsed); elapsed = t
    last = await ui(laptop, label); menu ||= last.menu
    console.log(`  Esc + ${t} ms:`, last)
  }
  check(!last.looking && last.locked, 'walking again within 2 s, the mouse locked')
  check(!menu, 'no pause menu on the way back')
  check(last.camera === (await ui(laptop, label)).camera, 'the camera stays put after it is back')
  // and the keys walk again (S: away from the desk; W would run into the chair)
  await page.keyboard.down('KeyS'); await page.waitForTimeout(400); await page.keyboard.up('KeyS'); await page.waitForTimeout(400)
  const walked = await ui(laptop, label), x0 = +last.camera.split(', ')[0], x1 = +walked.camera.split(', ')[0]
  check(x1 < x0 - 0.1, `S walks you away from the desk (x ${x0} -> ${x1})`)
}

console.log('Mhmd’s chair:')
await enter(CHAIR)
const s = await ui('mhmd', 'Mhmd’s desk')
console.log('  by the chair, turned to it:', s)
check(s.label !== 'Sit', `no Sit label on it any more (the label up: ${JSON.stringify(s.label)})`)
await page.screenshot({ path: '../build/renders/laptop_chair.png' })
if (errors.length) console.log('page errors:', errors)
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
await browser.close()
process.exit(failed ? 1 : 0)
