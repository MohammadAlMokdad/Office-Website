// Salah's desk check: by the desk, one label (SALAH'S DESK); E: the camera flies to the whole desk with both screens;
// D: the right screen (the chat, on the curved monitor); pick a model in the menu, type a message with W A S D in it
// (they type, the view stays), Enter (the answer, or the server's error without a key); a click outside the text box
// and A moves the view to the desk, A again to the left screen (our website, live): the mouse wheel scrolls it; Esc:
// back to walking, no pause menu, the mouse locked again. The website shows only while its screen is in view.
// Screenshots: build/renders/chat_*.png
//   node chat_check.mjs [message]      (start the app first: cd app && npm run preview; APP=http://localhost:<port>
//                                       if it is not on 4173)
import { chromium } from 'playwright-core'
const MESSAGE = process.argv[2] ?? 'Hi! In one sentence, what can you do?'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const ui = () => page.evaluate(() => ({
  label: document.querySelector('.prompt.on')?.textContent ?? null,
  view: window.__inspect.get().looking ? `${window.__inspect.get().looking.index + 1}/${window.__inspect.get().looking.views}` : null,
  corner: document.querySelector('.back-to-walking, .use-hint')?.textContent ?? null,
  keys: document.querySelector('.shortcuts')?.textContent ?? null,
  arrows: document.querySelectorAll('.browse-arrow').length,
  menu: !!document.querySelector('.card'),
  locked: !!document.pointerLockElement,
  camera: window.__three.camera.position.toArray().map((v) => +v.toFixed(2)).join(', '),
}))
const chat = () => page.evaluate(() => ({
  model: document.querySelector('.ch-model')?.textContent ?? null,
  user: [...document.querySelectorAll('.ch-user')].map((m) => m.textContent),
  answers: [...document.querySelectorAll('.ch-answer')].map((m) => m.textContent.slice(0, 200)),
}))
// the website: shown or not, and which of its sections it is at (its own counter, "03 / 08 — SERVICES")
const site = async () => {
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('iframe[title="Octopus"]').parentElement).visibility)
  const f = page.frames().find((f) => f.url().includes('octopus.eu.com/landing')) // (the site is a page in a frame of its own)
  const at = f && await f.evaluate(() => document.body.innerText.match(/\d\d\s*\/\s*\d\d\s*\S\s*[A-Z]+/)?.[0] ?? '?').catch(() => '?')
  return { shown, at }
}
const centre = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }, sel)
const key = async (k, wait = 1100) => { await page.keyboard.press(k); await page.waitForTimeout(wait) }

await page.goto(`${process.env.APP ?? 'http://localhost:4173'}/?debug&cam=0.3,-3.5,-0.85,-3.5,0.68`)
await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
  if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
  await page.waitForTimeout(1300)
}
await page.waitForTimeout(3000) // the website loading
console.log('by Salah\'s desk:', await ui(), await site())
await page.screenshot({ path: '../build/renders/chat_label.png' })
await key('KeyE'); console.log('E (the whole desk):', await ui(), await site())
await page.screenshot({ path: '../build/renders/chat_desk.png' })
await key('KeyD'); console.log('D (right screen, the chat):', await ui())
await page.screenshot({ path: '../build/renders/chat_close.png' })
const [mx, my] = await centre('.ch-model')
await page.mouse.click(mx, my); await page.waitForTimeout(400)
const [px, py] = await page.evaluate(() => { const b = [...document.querySelectorAll('.ch-menu button')].find((e) => e.textContent.includes('Sonnet')); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
await page.mouse.click(px, py); await page.waitForTimeout(400)
console.log('picked:', await page.evaluate(() => document.querySelector('.ch-model')?.textContent))
const [x, y] = await centre('.ch-composer textarea')
await page.mouse.click(x, y); await page.keyboard.type(MESSAGE + ' wasd'); await page.waitForTimeout(300)
console.log('typed with W A S D in it:', (await ui()).view, await page.evaluate(() => document.querySelector('.ch-composer textarea').value))
await page.keyboard.press('Enter'); await page.waitForTimeout(8000)
console.log('sent:', await chat())
await page.screenshot({ path: '../build/renders/chat_answer.png' })
await page.mouse.click(640, 712); await page.waitForTimeout(300) // outside the text box (below the screen)
await key('KeyA'); console.log('click outside, then A (the desk):', (await ui()).view)
await page.screenshot({ path: '../build/renders/chat_desk_after.png' })
await key('KeyA'); console.log('A (left screen, the website):', await ui(), await site())
await page.screenshot({ path: '../build/renders/chat_site.png' })
await page.mouse.move(640, 360)
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(400) }
await page.waitForTimeout(1200)
console.log('scrolled the website:', await site())
await page.screenshot({ path: '../build/renders/chat_site_scrolled.png' })
await page.keyboard.press('Escape')
for (const t of [300, 900, 1800]) { await page.waitForTimeout(t === 300 ? 300 : t - 300); console.log(`Esc + ${t} ms:`, await ui()) }
await page.screenshot({ path: '../build/renders/chat_back.png' })
// turn away from the desk: the website is hidden (and stops)
for (let i = 0; i < 12; i++) { await page.mouse.move(640 + (i + 1) * 60, 360); await page.waitForTimeout(30) }
await page.waitForTimeout(500)
console.log('turned away from the desk:', await site())
if (errors.length) console.log('errors:', errors)
await browser.close()
