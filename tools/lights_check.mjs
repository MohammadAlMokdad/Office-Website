// Lights check: (a) a fixed view of a lamp and the floor under it with everything on; (b) through window.__lights
// (Lights.tsx, ?debug) each lamp off in turn: its pool on the floor and its own glow must darken (mean brightness of
// those canvas regions, before / after), and switched back on the canvas must be the very same pixels as before;
// (c) walking by the switches: the label over the rocker nearest the middle of the view, E switches that lamp and
// tilts the rocker (its pixels change), E again switches it back. Frame rate with everything on and with a lamp off.
// Screenshots: build/renders/lights_on_<n>.png, lights_off_<n>.png, lights_glow_on.png, lights_glow_off.png,
// lights_switches.png, lights_switch_E.png
//   node lights_check.mjs      (start the app first; APP=http://localhost:4181 by default)
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'renders')
mkdirSync(OUT, { recursive: true })
const APP = (process.env.APP ?? 'http://localhost:4181').replace(/\/$/, '')
const scene = JSON.parse(readFileSync(join(ROOT, 'app', 'src', 'data', 'scene.json'), 'utf8'))
const lamps = scene.lamps ?? {}, switches = scene.switches ?? {}
const mapped = Object.keys(scene.atlases).filter((a) => scene.atlases[a].lamps && scene.atlases[a].day)
console.log(`scene.json: ${Object.keys(lamps).length} lamps, ${Object.keys(switches).length} switches, fraction maps for ${mapped.length} / ${Object.keys(scene.atlases).length} atlases${scene.lightGroups ? ', lightGroups' : ', no lightGroups'}`)

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const logs = []; page.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text()) }); page.on('pageerror', (e) => logs.push(e.message))
const settle = async () => {
  await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5 && (window.__office?.frames ?? 0) > 120, null, { timeout: 180000 })
  await page.waitForTimeout(2500)
}
// the canvas as pixels (preserveDrawingBuffer is on with ?debug): the mean brightness of a region, a digest of all
const pixels = () => page.evaluate(() => {
  const c = document.querySelector('canvas'), o = document.createElement('canvas')
  o.width = c.width; o.height = c.height
  const ctx = o.getContext('2d'); ctx.drawImage(c, 0, 0)
  const d = ctx.getImageData(0, 0, o.width, o.height).data
  // a digest that sees any single changed byte: two independent sums
  let s1 = 0, s2 = 0
  for (let i = 0; i < d.length; i++) { s1 = (s1 + d[i]) % 1000000007; s2 = (s2 * 31 + d[i]) % 1000000009 }
  return { width: o.width, height: o.height, digest: `${s1}-${s2}`, data: Array.from(d) }
})
const mean = (px, x, y, w, h) => {
  let s = 0, n = 0
  for (let j = Math.max(0, y); j < Math.min(px.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(px.width, x + w); i++) { const o = (j * px.width + i) * 4; s += (px.data[o] + px.data[o + 1] + px.data[o + 2]) / 3; n++ }
  return n ? s / n : NaN
}
const differ = (a, b, x, y, w, h) => { // pixels of a region that changed, and their mean change
  let n = 0, s = 0
  for (let j = Math.max(0, y); j < Math.min(a.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(a.width, x + w); i++) {
    const o = (j * a.width + i) * 4, d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]))
    if (d) { n++; s += d }
  }
  return { changed: n, of: w * h, meanChange: n ? +(s / n).toFixed(1) : 0 }
}
const project = (p) => page.evaluate(([x, y, z]) => { // a world point -> canvas pixel
  const v = new window.__three.camera.position.constructor(x, y, z).project(window.__three.camera)
  const c = document.querySelector('canvas')
  return [((v.x + 1) / 2) * c.width, ((1 - v.y) / 2) * c.height, v.z]
}, p)
const lightMix = () => page.evaluate(() => { let n = 0, all = 0; window.__three.scene.traverse((o) => { const m = o.material; if (m?.isShaderMaterial && m.uniforms?.map) { all++; if (m.defines?.LIGHT_MIX !== undefined) n++ } }); return `${n} of ${all} baked materials have LIGHT_MIX` })
const fps = () => page.evaluate(() => +window.__office.fps.toFixed(0))

// (a) + (b): each lamp from a fixed view: the camera 3.2 m from the lamp (towards the middle of the room, kept inside
// it), at eye height, aimed at the lamp's height minus one metre, a 16 mm lens: the lamp and the floor under it
const FLOOR = scene.floor, EYE = FLOOR + scene.eye
const [bMin, bMax] = [scene.env.boxMin, scene.env.boxMax]
const FROM_LAMP = 3.2, INSIDE = 0.35
if (!Object.keys(lamps).length) console.log('(a)/(b) skipped: scene.json has no lamps yet (P1 export)')
for (const [key, lamp] of Object.entries(lamps)) {
  const n = Number(key.slice(-1))
  const [lx, ly, lz] = lamp.center
  const mid = [(bMin[0] + bMax[0]) / 2, (bMin[2] + bMax[2]) / 2]
  const d = [mid[0] - lx, mid[1] - lz], len = Math.hypot(...d) || 1
  const cam = [lx + (d[0] / len) * FROM_LAMP, EYE, lz + (d[1] / len) * FROM_LAMP]
  cam[0] = Math.min(Math.max(cam[0], bMin[0] + INSIDE), bMax[0] - INSIDE); cam[2] = Math.min(Math.max(cam[2], bMin[2] + INSIDE), bMax[2] - INSIDE)
  const aim = [lx, ly - 1, lz]
  // three.js -> Blender: (x, y, z) -> (x, -z, y)
  const view = [cam[0], -cam[2], cam[1], aim[0], -aim[2], aim[1], 16]
  await page.goto(`${APP}/?debug&noui&view=${view.map((v) => +v.toFixed(3)).join(',')}`)
  await settle()
  if (n === 1) console.log(await lightMix())
  const on = await pixels()
  await page.screenshot({ path: join(OUT, `lights_on_${n}.png`) })
  const fpsOn = await fps()
  const [px, py] = await project([lx, ly - 0.12, lz]) // the lamp's heads
  const [fx, fy] = await project([lx, FLOOR, lz]) // the floor under it
  const box = { lamp: [Math.round(px) - 30, Math.round(py) - 20, 60, 40], floor: [Math.round(fx) - 50, Math.round(fy) - 40, 100, 80] }
  await page.evaluate((k) => window.__lights.toggle(k), n)
  await page.waitForTimeout(700)
  const off = await pixels()
  await page.screenshot({ path: join(OUT, `lights_off_${n}.png`) })
  await page.waitForTimeout(2500)
  const fpsOff = await fps()
  const state = await page.evaluate(() => window.__lights.state())
  await page.evaluate((k) => window.__lights.toggle(k), n)
  await page.waitForTimeout(700)
  const again = await pixels()
  await page.waitForTimeout(2500)
  const fpsAgain = await fps() // (the first reading after a load is still warming up)
  const r = (b) => `lamp ${mean(on, ...b.lamp).toFixed(1)} -> ${mean(b === box ? off : again, ...b.lamp).toFixed(1)}, floor ${mean(on, ...b.floor).toFixed(1)} -> ${mean(b === box ? off : again, ...b.floor).toFixed(1)}`
  console.log(`lamp ${n} (${key}) at three.js ${lamp.center.map((v) => +v.toFixed(2))}, switch ${lamp.switch}: mean brightness on -> off: ${r(box)}; whole canvas ${mean(on, 0, 0, on.width, on.height).toFixed(2)} -> ${mean(off, 0, 0, on.width, on.height).toFixed(2)}`)
  console.log(`  state with lamp ${n} off: ${JSON.stringify(state.find((s) => s.lamp === key))}`)
  console.log(`  fps all on ${fpsOn}, lamp ${n} off ${fpsOff}, all on again ${fpsAgain}`)
  const same = on.digest === again.digest
  const diff = differ(on, again, 0, 0, on.width, on.height)
  console.log(`  back on: canvas ${same ? 'IDENTICAL to before' : `DIFFERS: ${diff.changed} of ${diff.of} pixels changed (mean ${diff.meanChange})`}; lamp region ${JSON.stringify(differ(on, again, ...box.lamp))}, floor region ${JSON.stringify(differ(on, again, ...box.floor))}`)
}

// lamp 1 up close: its glow must go dark with its switch (the diffusers' own emission is in the lamp's own channel)
if (lamps.lamp_1) {
  const [lx, ly, lz] = lamps.lamp_1.center
  const cam = [lx + 1.0, EYE, lz + 0.9]
  await page.goto(`${APP}/?debug&noui&view=${[cam[0], -cam[2], cam[1], lx, -lz, ly, 24].map((v) => +v.toFixed(3)).join(',')}`)
  await settle()
  const on = await pixels()
  await page.screenshot({ path: join(OUT, 'lights_glow_on.png') })
  await page.evaluate(() => window.__lights.toggle(1)); await page.waitForTimeout(700)
  const off = await pixels()
  await page.screenshot({ path: join(OUT, 'lights_glow_off.png') })
  await page.evaluate(() => window.__lights.toggle(1)); await page.waitForTimeout(700)
  const again = await pixels()
  const [px, py] = await project([lx, ly, lz])
  const box = [Math.round(px) - 120, Math.round(py) - 60, 240, 120]
  console.log(`lamp 1 up close: mean brightness of the lamp on -> off: ${mean(on, ...box).toFixed(1)} -> ${mean(off, ...box).toFixed(1)} (${JSON.stringify(differ(on, off, ...box))}); back on: ${on.digest === again.digest ? 'IDENTICAL' : JSON.stringify(differ(on, again, 0, 0, on.width, on.height))}`)
}

// (c) walking: by the switches, facing the wall
const ui = () => page.evaluate(() => ({
  label: document.querySelector('.prompt.on')?.textContent ?? null,
  locked: !!document.pointerLockElement,
  lights: window.__lights?.state().map((s) => `${s.name}:${s.on ? 'on' : 'off'} ${s.angle.toFixed(1)}° w=${s.weight.toFixed(2)}${s.mesh ? '' : ' NO MESH'}`).join(', '),
}))
if (!Object.keys(switches).length) console.log('(c) skipped: scene.json has no switches yet (P1 export)')
else {
  await page.goto(`${APP}/?debug&cam=-2.05,1.5,-2.05,2.2,0.78`)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
  await page.waitForTimeout(1500)
  const before = await ui()
  console.log('by the switches, facing the wall:', before)
  await page.screenshot({ path: join(OUT, 'lights_switches.png') })
  const px0 = await pixels()
  // the rocker under the label: its box on the canvas
  const name = Object.keys(switches).find((k) => before.label?.includes(`Light ${switches[k].controls.slice(-1)}`))
  const sw = switches[name ?? Object.keys(switches)[0]]
  const [[x0, y0, z0], [x1, y1, z1]] = sw.box
  const corners = await Promise.all([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]].map(project))
  const rx = Math.floor(Math.min(...corners.map((c) => c[0]))) - 3, ry = Math.floor(Math.min(...corners.map((c) => c[1]))) - 3
  const rw = Math.ceil(Math.max(...corners.map((c) => c[0]))) - rx + 6, rh = Math.ceil(Math.max(...corners.map((c) => c[1]))) - ry + 6
  console.log(`rocker ${name ?? '?'} on the canvas: x ${rx}..${rx + rw}, y ${ry}..${ry + rh}`)
  await page.keyboard.press('KeyE'); await page.waitForTimeout(900)
  const afterE = await ui()
  console.log('E:', afterE)
  await page.screenshot({ path: join(OUT, 'lights_switch_E.png') })
  const px1 = await pixels()
  console.log(`  rocker pixels changed by E: ${JSON.stringify(differ(px0, px1, rx, ry, rw, rh))}; whole canvas: ${JSON.stringify(differ(px0, px1, 0, 0, px0.width, px0.height))}`)
  await page.keyboard.press('KeyE'); await page.waitForTimeout(900)
  const afterE2 = await ui()
  console.log('E again:', afterE2)
  const px2 = await pixels()
  console.log(`  rocker pixels vs the start: ${JSON.stringify(differ(px0, px2, rx, ry, rw, rh))}; whole canvas ${px0.digest === px2.digest ? 'IDENTICAL' : JSON.stringify(differ(px0, px2, 0, 0, px0.width, px0.height))}`)
}
const noise = logs.filter((l) => !/X4122|THREE\.Clock|AudioContext was not allowed/.test(l))
if (noise.length) console.log('console:', noise.slice(0, 10).join('\n'))
await browser.close()
