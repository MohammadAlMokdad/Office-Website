// Blinds check. a) Fixed views of each window (South, East, Angled): the blinds up, the blackout blinds down (through
// the debug hook of Blinds.tsx, 4.5 s later), the sheer ones down too, then both up again: that picture must be the
// first one again, pixel for pixel. b) Walking by the drawer unit, turned to the two remotes: their tags (1 Blackout
// blinds, 2 Sheer blinds) and the keys in the corner; 1 rolls the blackout blinds down (the label flips to "up"),
// 1 again rolls them up; 3 m away the tags and the keys are gone.
// Screenshots: build/renders/blinds_<window>_{up,dark,both,up2}.png, blinds_remotes.png, blinds_remotes_down.png,
// blinds_away.png
//   node blinds_check.mjs      (start the app first, best a built one so nothing reloads mid-way: cd app && npm run build
//                               && npx vite preview --port 4182; APP=http://host:port points the check elsewhere)
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { chromium } from 'playwright-core'

const APP = (process.env.APP ?? 'http://localhost:4182').replace(/\/$/, '')
const OUT = '../build/renders'
const manifest = JSON.parse(readFileSync('../app/src/data/scene.json', 'utf8'))
if (!manifest.blinds) { console.log('app/src/data/scene.json has no "blinds" yet (the Blender export + compress have not landed): nothing to check'); process.exit(1) }

// eye points in the room, about 2.5 m from each window, looking at the middle of its glass (Blender coordinates:
// x, y, z, target x, y, z, lens mm)
const E = -0.367 + 1.62 // standing eye height
const VIEWS = {
  South: [-1.487, -1.9, E, -1.487, -4.475, 1.47, 18],
  East: [-0.3, 0.455, E, 2.165, 0.455, 1.53, 18],
  Angled: [-0.795, -1.87, E, 1.378, -2.888, 1.48, 18],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const logs = []; page.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text()) }); page.on('pageerror', (e) => logs.push(e.message))
const state = () => page.evaluate(() => {
  const s = window.__blinds.state()
  const r = (v) => +v.toFixed(3)
  return `dark ${s.dark.down ? 'down' : 'up'} ${r(s.dark.fraction)}${s.dark.moving ? ' moving' : ''}, light ${s.light.down ? 'down' : 'up'} ${r(s.light.fraction)}${s.light.moving ? ' moving' : ''}, sheets ${s.sheets}, windows ${Object.entries(s.windows).map(([k, v]) => `${k} ${r(v)}`).join(' ')}, sun ${r(s.sun)}, room light ${r(s.room)}`
})
const settle = async () => {
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5 && (window.__office?.frames ?? 0) > 120 && !!window.__blinds, null, { timeout: 180000 })
  await page.waitForTimeout(2500)
}
const shot = (file) => page.screenshot({ path: `${OUT}/${file}` })
// how many pixels differ between two screenshots (and the largest difference in any channel), leaving out the debug
// HUD's box at the top left (its texture and mesh counts change as the sheets come and go) and the screens in view
// (a video plays on Ali's, a cursor blinks on the laptops): `masks` = [x0, y0, x1, y1] boxes
const HUD = [0, 0, 270, 95]
const compare = (a, b, masks) => {
  const A = PNG.sync.read(readFileSync(`${OUT}/${a}`)), B = PNG.sync.read(readFileSync(`${OUT}/${b}`))
  if (A.width !== B.width || A.height !== B.height) return { pixels: -1, max: 255, of: 0 }
  const boxes = [HUD, ...masks]
  let pixels = 0, max = 0, of = 0, box = [Infinity, Infinity, -Infinity, -Infinity]
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    if (boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue
    of++
    const i = (y * A.width + x) * 4
    let d = 0
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]))
    if (d) { pixels++; max = Math.max(max, d); box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] }
  }
  return { pixels, max, of, box }
}
// the screens in view, as boxes on the screenshot (each screen_* mesh's bounds, projected by the page's camera)
const screenBoxes = () => page.evaluate(() => {
  const cam = window.__three.camera, V = cam.position.constructor, out = []
  window.__three.scene.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('screen_')) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    const { min, max } = o.geometry.boundingBox, box = [Infinity, Infinity, -Infinity, -Infinity]
    let behind = false
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const p = new V(x, y, z).applyMatrix4(o.matrixWorld).project(cam)
      if (p.z > 1) behind = true
      const sx = ((p.x + 1) / 2) * innerWidth, sy = ((1 - p.y) / 2) * innerHeight
      box[0] = Math.min(box[0], sx - 2); box[1] = Math.min(box[1], sy - 2); box[2] = Math.max(box[2], sx + 2); box[3] = Math.max(box[3], sy + 2)
    }
    if (!behind && box[2] > 0 && box[3] > 0 && box[0] < innerWidth && box[1] < innerHeight) out.push(box.map(Math.round))
  })
  return out
})

// a) each window, fixed view: up, blackout down, sheer down too, both up again (the same picture as at the start)
let same = true
for (const [w, v] of Object.entries(VIEWS)) {
  if (!manifest.blinds[w]) { console.log(`${w}: no such window in scene.json`); continue }
  await page.goto(`${APP}/?debug&noui&view=${v.join(',')}`)
  await settle()
  const masks = await screenBoxes()
  console.log(`${w}, blinds up:`, await state())
  await shot(`blinds_${w}_up.png`)
  await page.evaluate(() => window.__blinds.set('dark', true)); await page.waitForTimeout(4500)
  console.log(`${w}, blackout down:`, await state())
  await shot(`blinds_${w}_dark.png`)
  await page.evaluate(() => window.__blinds.set('light', true)); await page.waitForTimeout(4500)
  console.log(`${w}, sheer down too:`, await state())
  await shot(`blinds_${w}_both.png`)
  await page.evaluate(() => window.__blinds.set('dark', false)); await page.waitForTimeout(4500)
  console.log(`${w}, sheer only:`, await state())
  await shot(`blinds_${w}_light.png`)
  await page.evaluate(() => window.__blinds.set('light', false)); await page.waitForTimeout(4500)
  console.log(`${w}, both up again:`, await state())
  await shot(`blinds_${w}_up2.png`)
  const d = compare(`blinds_${w}_up.png`, `blinds_${w}_up2.png`, masks)
  console.log(`${w}: up again vs at the start: ${d.pixels} of ${d.of} pixels differ (largest difference ${d.max}; ${masks.length} screens left out)${d.pixels ? `  <-- NOT identical, within x ${d.box[0]}..${d.box[2]} y ${d.box[1]}..${d.box[3]}` : ''}`)
  if (d.pixels) same = false
}

// b) walking by the drawer unit, turned to the remotes
const ui = () => page.evaluate(() => ({
  tags: [...document.querySelectorAll('.callout')].filter((c) => c.style.display !== 'none').map((c) => c.textContent),
  keys: document.querySelector('.shortcuts')?.textContent ?? null,
  label: document.querySelector('.prompt.on')?.textContent ?? null,
  locked: !!document.pointerLockElement,
}))
// plan distance from the remotes (between the two), m
const remotes = ['blindRemoteRed', 'blindRemoteBlue'].map((k) => manifest.props?.[k]?.center ?? [0, 0, 0])
const mid = [(remotes[0][0] + remotes[1][0]) / 2, (remotes[0][2] + remotes[1][2]) / 2]
const where = () => page.evaluate(([x, z]) => { const c = window.__three.camera.position; return +Math.hypot(c.x - x, c.z - z).toFixed(2) }, mid)
const enter = async (url) => {
  await page.goto(url)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
}
await enter(`${APP}/?debug&cam=-1.3,-2.0,-0.96,-2.3,0.1`)
await page.waitForTimeout(800)
let u = await ui()
console.log('by the remotes:', u, 'distance', await where())
await shot('blinds_remotes.png')
const tagsOk = u.tags.includes('1Blackout blinds') && u.tags.includes('2Sheer blinds')
const keysOk = !!u.keys && u.keys.includes('1 blackout blinds down') && u.keys.includes('2 sheer blinds down')
console.log(`tags ${tagsOk ? 'ok' : 'WRONG'}, keys ${keysOk ? 'ok' : 'WRONG'}`)
await page.keyboard.press('Digit1'); await page.waitForTimeout(400)
u = await ui()
console.log('1 pressed:', await state(), '| keys:', u.keys, (u.keys ?? '').includes('1 blackout blinds up') ? '(label flipped ok)' : '(label NOT flipped)')
await page.waitForTimeout(4300)
console.log('4.7 s later:', await state())
await shot('blinds_remotes_down.png')
await page.keyboard.press('Digit1'); await page.waitForTimeout(400)
console.log('1 again:', await state(), '| keys:', (await ui()).keys)
await page.waitForTimeout(4300)
console.log('4.7 s later:', await state())

// walk away. The spot above is wedged between the drawer unit and the recliner (their gap is narrower than the walker:
// the collider holds you there), so this starts from the open side of the drawer unit, by the round table, where the
// tags and the keys show too, and walks north past the recliner.
await enter(`${APP}/?debug&cam=-0.44,-1.55,-0.96,-2.3,0.1`)
await page.waitForTimeout(800)
u = await ui()
console.log(`by the round table (${await where()} m from the remotes):`, u.tags, u.keys)
await page.evaluate(() => { const c = window.__three.camera; c.lookAt(c.position.x, c.position.y, c.position.z - 1) }) // turned north
await page.waitForTimeout(100)
await page.keyboard.down('KeyW'); await page.waitForTimeout(2600); await page.keyboard.up('KeyW')
await page.waitForTimeout(400)
await page.evaluate(() => { const c = window.__three.camera; c.lookAt(-0.965, 0.1, 2.3) }) // turned back to the remotes
await page.waitForTimeout(500)
u = await ui()
const far = await where()
const gone = far > 2.6 && !u.tags.some((t) => /blinds/i.test(t)) && !(u.keys ?? '').includes('blinds') // (the TV remotes' tags may show: the recliner is here)
console.log(`walked away (${far} m from the remotes):`, u, gone ? 'blinds tags and keys gone ok' : 'blinds tags or keys STILL THERE')
await shot('blinds_away.png')
console.log(`pictures back to the start: ${same ? 'identical' : 'NOT identical'}`)
const noise = logs.filter((l) => !/X4122|THREE\.Clock/.test(l))
if (noise.length) console.log('console:', noise.slice(0, 10).join('\n'))
await browser.close()
