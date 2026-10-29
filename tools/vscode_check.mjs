// VS Code on the laptops check (app/src/vscode/VSCodeApp.tsx). Flat first: ?vscode=1 mounts VS Code over the window
// at the laptop screen's 1366 x 768 (see the end of VSCodeApp.tsx). It opens a file from the explorer, types in the
// editor (the store gets it), makes notes.txt through New File, takes a change from "the other laptop", runs the app
// (the browser window shows index.html's page, a click on its button logs to the terminal), downloads my-app.zip
// (unzipped and checked with fflate), deletes through VS Code's dialog, tries Ctrl+S, the empty editor, and the page
// scaled to 0.6 (CodeMirror under a transform, as on the laptop's screen). Then, with --office: by Mhmd's desk, E
// flies to his laptop, a click in the editor and the keys type (W A S D included), Esc back to walking, E again and
// the VS Code window's close button back to walking too.
// Screenshots: build/renders/vscode_*.png, the zip: build/renders/my-app.zip
//   node vscode_check.mjs [--office | --office-only]   (start the app first: cd app && npx vite --port 4183
//                                                       --strictPort; APP=http://localhost:<port> if it is elsewhere)
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { strFromU8, unzipSync } from '../app/node_modules/fflate/esm/index.mjs'

const APP = process.env.APP ?? 'http://localhost:4183'
const OFFICE = process.argv.includes('--office') || process.argv.includes('--office-only')
const FLAT = !process.argv.includes('--office-only')
const OUT = '../build/renders'
mkdirSync(OUT, { recursive: true })
let failed = 0
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`); if (!ok) failed++ }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
const shot = (name) => page.screenshot({ path: `${OUT}/vscode_${name}.png` })
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel)
const read = (path) => page.evaluate((p) => window.__workspace.read(p), path)
// the store saves itself a moment after a change: a known starting point, kept across the next load
const reset = async () => { await page.evaluate(() => window.__workspace.reset()); await page.waitForTimeout(600) }
// the editor writes to the store a moment after the last key (and the office's render loop runs under the flat page)
const stored = (path, part) => page.waitForFunction(([p, s]) => (window.__workspace.read(p) ?? '').includes(s), [path, part], { timeout: 8000 }).then(() => true, () => false)
const tab = () => text('#vsc-flat .vsc-tab.on > span')
const terminal = () => text('#vsc-flat .vsc-terminal')
const edited = () => page.evaluate(() => document.querySelector('#vsc-flat .vsc .cm-content')?.textContent ?? '')

async function flat() {
  await page.goto(`${APP}/?debug&vscode=1`)
  await page.waitForSelector('#vsc-flat .vsc .vsc-row', { timeout: 120000 })
  await reset()
  check('VS Code is up with the explorer', (await page.evaluate(() => document.querySelectorAll('#vsc-flat .vsc .vsc-row').length)) >= 4)
  check('the title', (await text('#vsc-flat .vsc-command'))?.includes('my-app - Visual Studio Code'), await text('#vsc-flat .vsc-command'))
  check('the AI side bar is open', !!(await page.$('#vsc-flat .vsc-aux .vsc-aux-body')))
  check('Accounts shows the user', (await page.getAttribute('#vsc-flat .vsc-activity [aria-label^="Accounts"]', 'title')) === 'Accounts (Mhmd)')
  await shot('start')

  // a file from the explorer, typing in it
  await page.click('#vsc-flat .vsc-row[title="app.js"]')
  await page.waitForTimeout(300)
  check('app.js opened in a tab', (await tab()) === 'app.js', await tab())
  check('breadcrumbs', /^my-app.*app\.js$/.test((await text('#vsc-flat .vsc-breadcrumbs')) ?? ''), await text('#vsc-flat .vsc-breadcrumbs'))
  check('the editor shows it', (await edited()).includes('const button'))
  await page.click('#vsc-flat .vsc .cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter')
  await page.keyboard.type("console.log('typed in the check')")
  check('typing reaches the store', await stored('app.js', "\nconsole.log('typed in the check')"), JSON.stringify((await read('app.js')).slice(-60)))
  check('the status bar has the cursor', /Ln \d+, Col \d+/.test(await text('#vsc-flat .vsc-status-right')), await text('#vsc-flat .vsc-status-right'))
  await page.keyboard.press('Control+s'); await page.waitForTimeout(200)
  check('Ctrl+S shows Saved', (await text('#vsc-flat .vsc-status-left'))?.includes('Saved'))
  await shot('editor')

  // New File
  await page.hover('#vsc-flat .vsc-sidebar'); await page.click('#vsc-flat .vsc-new-file')
  await page.waitForSelector('#vsc-flat .vsc-name-box input')
  await page.keyboard.type('notes.txt'); await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('notes.txt is in the store', (await read('notes.txt')) === '', JSON.stringify(await read('notes.txt')))
  check('notes.txt is in the tree', !!(await page.$('#vsc-flat .vsc-row[title="notes.txt"]')))
  check('notes.txt opened', (await tab()) === 'notes.txt', await tab())
  await page.click('#vsc-flat .vsc .cm-content'); await page.keyboard.type('Hello notes')
  check('typed into the new file', await stored('notes.txt', 'Hello notes') && (await read('notes.txt')) === 'Hello notes', JSON.stringify(await read('notes.txt')))
  // a change from elsewhere (the other laptop, the AI) replaces what the editor shows
  await page.evaluate(() => window.__workspace.write('notes.txt', 'Hello notes from the other laptop', 'test'))
  await page.waitForTimeout(300)
  check('a change from another origin shows in the editor', (await edited()).includes('from the other laptop'), await edited())
  // a file made elsewhere (the other laptop, the AI) is in the tree at once
  await page.evaluate(() => window.__workspace.create('from_other.js', 'export const other = true\n', 'test'))
  await page.waitForTimeout(200)
  check('a file created elsewhere shows in the explorer', !!(await page.$('#vsc-flat .vsc-row[title="from_other.js"]')))
  await page.evaluate(() => window.__workspace.remove('from_other.js', 'test'))
  // a folder in the name makes the folder
  await page.hover('#vsc-flat .vsc-sidebar'); await page.click('#vsc-flat .vsc-new-file')
  await page.waitForSelector('#vsc-flat .vsc-name-box input'); await page.keyboard.type('src/util.js'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  check('src/util.js made its folder', (await read('src/util.js')) === '' && !!(await page.$('#vsc-flat .vsc-row[title="src"]')))
  // a name that exists is refused inline (no browser dialog); the new file goes next to the selected one (README.md: the root)
  await page.click('#vsc-flat .vsc-row[title="README.md"]'); await page.waitForTimeout(150)
  await page.hover('#vsc-flat .vsc-sidebar'); await page.click('#vsc-flat .vsc-new-file')
  await page.waitForSelector('#vsc-flat .vsc-name-box input'); await page.keyboard.type('index.html'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
  check('an existing name is refused inline', !!(await page.$('#vsc-flat .vsc-name-error')), await text('#vsc-flat .vsc-name-error'))
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await shot('newfile')

  // Run: the browser window with the page, its console in the terminal
  await page.click('#vsc-flat .vsc-run')
  await page.waitForSelector('#vsc-flat .vsc-browser')
  const frame = await (async () => { for (let i = 0; i < 50; i++) { const f = page.frame({ name: 'preview-mhmd' }); if (f) return f; await page.waitForTimeout(100) } })()
  check('the preview frame exists', !!frame)
  await frame.waitForSelector('h1', { timeout: 10000 })
  await page.waitForTimeout(600)
  check('the preview is index.html', (await frame.title()) === 'My App' && (await frame.textContent('h1')).includes('Hello from the office'), await frame.title())
  check('the browser tab reads the title', (await text('#vsc-flat .vsc-br-tab span')) === 'My App', await text('#vsc-flat .vsc-br-tab span'))
  check('the address bar', (await text('#vsc-flat .vsc-br-url')) === 'http://localhost:3000/', await text('#vsc-flat .vsc-br-url'))
  check('the stylesheet loaded in the preview', await frame.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(15, 23, 42)'))
  check('the terminal shows the server', (await terminal())?.includes('Local:   http://localhost:3000/'))
  check('the terminal shows the page\'s console', (await terminal())?.includes('app.js loaded'), (await terminal())?.slice(-200))
  check('the typed line ran in the preview', (await terminal())?.includes('typed in the check'))
  await shot('run')
  await frame.click('#count'); await page.waitForTimeout(300)
  check('the counter button works in the preview', (await frame.textContent('#count')) === 'Clicked 1 time', await frame.textContent('#count'))
  check('its console.log is in the terminal', (await terminal())?.includes('clicks: 1'), (await terminal())?.slice(-120))
  // a broken script: the error reaches the terminal
  await page.evaluate(() => window.__workspace.write('src/util.js', 'export const x = 1\nthrow new Error("boom from util")', 'test'))
  await page.evaluate(() => window.__workspace.write('index.html', window.__workspace.read('index.html').replace('</body>', '<script type="module">import { x } from "./src/util.js"; console.log("x is", x)</script></body>'), 'test'))
  await page.click('#vsc-flat .vsc-br-bar button[title="Reload"]'); await page.waitForTimeout(1200)
  check('a module import between files and its error reach the terminal', (await terminal())?.includes('boom from util'), (await terminal())?.slice(-160))
  await page.click('#vsc-flat .vsc-br-controls button[title="Minimize"]'); await page.waitForTimeout(200)
  check('minimised to a chip', !!(await page.$('#vsc-flat .vsc-br-chip')) && !(await page.$('#vsc-flat .vsc-browser')))
  await shot('terminal')
  await page.click('#vsc-flat .vsc-br-chip'); await page.waitForTimeout(200)
  check('the chip brings the browser back', !!(await page.$('#vsc-flat .vsc-browser')))
  await page.click('#vsc-flat .vsc-br-controls button.close'); await page.waitForTimeout(200)

  // Download: my-app.zip through a real download, checked with fflate
  await page.hover('#vsc-flat .vsc-sidebar')
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#vsc-flat .vsc-download')])
  check('the download is my-app.zip', download.suggestedFilename() === 'my-app.zip', download.suggestedFilename())
  await download.saveAs(`${OUT}/my-app.zip`)
  const zip = unzipSync(new Uint8Array(await readFile(`${OUT}/my-app.zip`)))
  const names = Object.keys(zip)
  check('the zip holds my-app/index.html', names.includes('my-app/index.html'), names.join(', '))
  check('the zip has the new files', names.includes('my-app/notes.txt') && names.includes('my-app/src/util.js') && strFromU8(zip['my-app/notes.txt']) === 'Hello notes from the other laptop')
  const [download2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#vsc-flat .vsc-download-item')])
  check('the toolbar Download item too', download2.suggestedFilename() === 'my-app.zip')

  // delete through VS Code's dialog; the right-click menu
  await page.hover('#vsc-flat .vsc-row[title="notes.txt"]'); await page.click('#vsc-flat .vsc-row[title="notes.txt"] button[title="Delete"]')
  await page.waitForSelector('#vsc-flat .vsc-dialog')
  check('the delete dialog asks', (await text('#vsc-flat .vsc-dialog'))?.includes("delete 'notes.txt'"), await text('#vsc-flat .vsc-dialog'))
  await shot('dialog')
  await page.click('#vsc-flat .vsc-dialog .vsc-button:not(.secondary)'); await page.waitForTimeout(300)
  check('notes.txt deleted, its tab closed', (await read('notes.txt')) === undefined && !(await page.$('#vsc-flat .vsc-row[title="notes.txt"]')) && (await tab()) !== 'notes.txt')
  await page.click('#vsc-flat .vsc-row[title="style.css"]', { button: 'right' }); await page.waitForTimeout(200)
  check('the right-click menu', !!(await page.$('#vsc-flat .vsc-menu')) && (await text('#vsc-flat .vsc-menu'))?.includes('Rename'))
  await shot('menu')
  await page.mouse.click(700, 400); await page.waitForTimeout(200)
  check('a click elsewhere closes it', !(await page.$('#vsc-flat .vsc-menu')))
  // rename through the hover action
  await page.hover('#vsc-flat .vsc-row[title="src/util.js"]'); await page.click('#vsc-flat .vsc-row[title="src/util.js"] button[title="Rename"]')
  await page.waitForSelector('#vsc-flat .vsc-name-box input'); await page.keyboard.press('Control+a'); await page.keyboard.type('helpers.js'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  check('renamed', (await read('src/helpers.js'))?.includes('boom') && (await read('src/util.js')) === undefined)
  // the empty editor
  for (let i = 0; i < 6 && (await page.$('#vsc-flat .vsc-tab.on')); i++) { await page.click('#vsc-flat .vsc-tab.on .x'); await page.waitForTimeout(100) }
  check('the empty editor shows the hints', !!(await page.$('#vsc-flat .vsc-welcome')) && (await text('#vsc-flat .vsc-welcome'))?.includes('Show All Commands'))
  await shot('welcome')
  await page.click('#vsc-flat .vsc-activity [aria-label^="Search"]'); await page.waitForTimeout(100)
  await page.click('#vsc-flat .vsc-search-box input'); await page.keyboard.type('button'); await page.waitForTimeout(200)
  check('search finds lines', (await text('#vsc-flat .vsc-search-results'))?.includes('results in'), (await text('#vsc-flat .vsc-search-msg')))
  await shot('search')
  await page.click('#vsc-flat .vsc-aux .vsc-view-title button[title="Hide Secondary Side Bar"]'); await page.waitForTimeout(100)
  check('the chat side bar hides', !(await page.$('#vsc-flat .vsc-aux')))
  await page.click('#vsc-flat .vsc-chat-btn'); await page.waitForTimeout(100)
  check('and the chat button shows it again', !!(await page.$('#vsc-flat .vsc-aux')))

  // the page scaled to 0.6, as the 3D transform scales it on the laptop's screen: clicks land where they should
  await page.goto(`${APP}/?debug&vscode=1&scale=0.6`)
  await page.waitForSelector('#vsc-flat .vsc .vsc-row', { timeout: 120000 }); await page.waitForTimeout(400)
  await page.click('#vsc-flat .vsc-row[title="style.css"]'); await page.waitForTimeout(300)
  const line2 = await page.evaluate(() => { const r = document.querySelectorAll('#vsc-flat .vsc .cm-line')[1].getBoundingClientRect(); return [r.right - 2, r.top + r.height / 2] })
  await page.mouse.click(line2[0], line2[1]); await page.keyboard.type(' /* scaled */')
  check('typing at a clicked spot in the scaled page', await stored('style.css', 'margin: 0; /* scaled */'), JSON.stringify((await read('style.css')).split('\n')[1]))
  await shot('scaled')
  await reset()
  check('no page errors (the preview\'s own throw aside)', !errors.filter((e) => !e.includes('boom from util')).length, errors.join(' | '))
}

async function office() {
  errors.length = 0
  await page.goto(`${APP}/?debug&cam=0.5,-0.1,1.75,-0.09,0.55`)
  await page.waitForSelector('button.enter:not([disabled])', { timeout: 180000 }); await page.waitForTimeout(1200)
  await reset()
  for (let i = 0; i < 4 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { // headless Chrome sometimes refuses the first lock
    if (await page.isVisible('button.enter:not([disabled])')) await page.click('button.enter')
    await page.waitForTimeout(1300)
  }
  await page.waitForTimeout(1000)
  const label = await text('.prompt.on')
  check('by Mhmd\'s desk: the label', label?.toLowerCase().includes('mhmd'), label)
  await shot('office_label')
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1600)
  const looking = await page.evaluate(() => window.__inspect.get().looking?.name ?? null)
  check('E flies to the laptop', looking === 'laptop_mhmd', looking)
  check('the page is in use', await page.evaluate(() => !!window.__laptops?.mhmd?.using))
  await shot('office_screen')
  const laptopTab = () => page.waitForFunction(() => window.__laptops.mhmd.el.querySelector('.vsc-tab.on > span')?.textContent ?? null, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => null)
  const first = await laptopTab()
  check('a file is open on the laptop', !!first, first)
  const box = await page.evaluate(() => { const r = window.__laptops.mhmd.el.querySelector('.cm-content').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 30] })
  await page.mouse.click(box[0], box[1]); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter')
  await page.keyboard.type('// wasd typed here')
  check('the keys type on the laptop (W A S D too)', await stored(first, '// wasd typed here'), `${first}: ${JSON.stringify((await read(first))?.slice(-40))}`)
  check('still looking at the laptop', (await page.evaluate(() => window.__inspect.get().looking?.name)) === 'laptop_mhmd')
  await shot('office_typed')
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
  check('Esc flies back to walking', (await page.evaluate(() => window.__inspect.get().looking)) === null)
  // the VS Code window's close button does the same as Esc
  await page.waitForTimeout(1000)
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1600)
  check('E flies to the laptop again', (await page.evaluate(() => window.__inspect.get().looking?.name ?? null)) === 'laptop_mhmd')
  const x = await page.evaluate(() => { const r = window.__laptops.mhmd.el.querySelector('.vsc-window-controls .close').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
  await page.mouse.click(x[0], x[1]); await page.waitForTimeout(1500)
  check("the window's close button flies back to walking", (await page.evaluate(() => window.__inspect.get().looking)) === null, `locked after: ${await page.evaluate(() => !!document.pointerLockElement)}`)
  check('no page errors in the office', !errors.length, errors.join(' | '))
  await reset()
}

if (FLAT) await flat()
if (OFFICE) await office()
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
