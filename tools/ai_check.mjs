// AI panel check (AiPanel.tsx alone on the page, ?aipanel=1, until VS Code is around it): the welcome screen with the
// model's name, a request typed and sent with Enter, the answer streaming in with its file block, Apply, and the
// workspace changed (window.__workspace, with ?debug). The name shown must follow the server's brand: Claude's only
// when a Claude model answers.
// Screenshots: build/renders/ai_welcome.png, ai_typed.png, ai_streaming.png, ai_answer.png, ai_applied.png
//   node ai_check.mjs [message]      (start the app first: cd app && npx vite --port 4184 --strictPort;
//                                     APP=http://localhost:<port> if it is elsewhere)
import { chromium } from 'playwright-core'
const APP = process.env.APP ?? 'http://localhost:4184'
const MESSAGE = process.argv[2] ?? 'Add a footer with the year to index.html'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 380, height: 760 } }) // the secondary side bar's size
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (/error|warn/i.test(m.type()) && /ai|react|markdown/i.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`) }) // the panel's own warnings
// (only the harness's panel: VS Code on the laptops' screens, behind the canvas, holds one more each)
const panel = () => page.evaluate(() => ({
  title: document.querySelector('.ai-harness .ai-title')?.textContent ?? null,
  model: document.querySelector('.ai-harness .ai-model')?.textContent ?? null,
  welcome: document.querySelector('.ai-harness .ai-welcome h2')?.textContent ?? null,
  chips: [...document.querySelectorAll('.ai-harness .ai-chips button')].map((b) => b.textContent),
  users: [...document.querySelectorAll('.ai-harness .ai-user .ai-text')].map((m) => m.textContent),
  answers: [...document.querySelectorAll('.ai-harness .ai-answer .ai-text')].map((m) => m.textContent.slice(0, 120)),
  blocks: [...document.querySelectorAll('.ai-harness .ai-block')].map((b) => ({ path: b.querySelector('.ai-block-path')?.textContent ?? null, button: (b.querySelector('.ai-apply') ?? b.querySelector('.ai-applied'))?.textContent ?? null })),
  applyAll: document.querySelector('.ai-harness .ai-all')?.textContent ?? null,
  busy: !!document.querySelector('.ai-harness .ai-busy'),
  error: !!document.querySelector('.ai-harness .ai-error'),
}))
let failed = 0
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failed++ }

for (let attempt = 1; ; attempt++) { // (the dev server reloads the page when a file changes under it: then once more)
  try {
    await page.goto(`${APP}/?debug&aipanel=1`); await page.waitForTimeout(500)
    // should VS Code (VSCodeApp.tsx, on the laptops' screens) not import the panel, its module is loaded by hand: the harness in it mounts the panel
    await page.addScriptTag({ type: 'module', content: "import '/src/vscode/AiPanel.tsx'" })
    await page.waitForSelector('.ai-harness .ai-welcome', { timeout: 30000 })
    break
  } catch (e) { if (attempt === 3) throw e; console.log('the page reloaded while starting, once more:', e.message.split('\n')[0]) }
}
await page.waitForFunction(() => !/…/.test(document.querySelector('.ai-harness .ai-model')?.textContent ?? '…'), null, { timeout: 15000 })
const info = await page.evaluate(() => fetch('/api/chat').then((r) => r.json()))
const start = await panel(); console.log('model:', info, '\nwelcome:', start)
check(start.title === 'Chat' && start.chips.length === 4 && start.model.startsWith(info.label), 'the welcome screen: CHAT, the model, 4 chips')
check(start.welcome === `Ask ${info.brand === 'claude' ? 'Claude' : info.label} to write code`, `the name shown follows the brand (${info.brand}: "${start.welcome}")`)
await page.screenshot({ path: '../build/renders/ai_welcome.png' })

await page.click('.ai-harness .ai-composer textarea'); await page.keyboard.type(MESSAGE); await page.waitForTimeout(200)
check((await page.inputValue('.ai-harness .ai-composer textarea')) === MESSAGE, 'typed into the box')
await page.screenshot({ path: '../build/renders/ai_typed.png' })
await page.keyboard.press('Enter')
await page.waitForSelector('.ai-harness .ai-answer', { timeout: 10000 })
await page.waitForTimeout(1500); console.log('streaming:', await panel())
await page.screenshot({ path: '../build/renders/ai_streaming.png' })
await page.waitForFunction(() => !document.querySelector('.ai-harness .ai-busy'), null, { timeout: 40000 })
const done = await panel(); console.log('answer:', done)
check(!done.error, 'no error')
check(done.users[0] === MESSAGE, 'the request is shown')
check(done.blocks.some((b) => b.path === 'index.html' && b.button === 'Apply'), 'a file block for index.html with Apply')
await page.screenshot({ path: '../build/renders/ai_answer.png' })

const before = await page.evaluate(() => window.__workspace.read('index.html'))
await page.locator('.ai-harness .ai-block', { hasText: 'index.html' }).locator('.ai-apply').first().click()
await page.waitForTimeout(300)
const after = await page.evaluate(() => window.__workspace.read('index.html'))
check(after !== before && /footer/i.test(after), `index.html in the workspace has the footer (${before.length} -> ${after.length} chars)`)
const applied = await panel(); console.log('applied:', applied.blocks)
check(applied.blocks.some((b) => b.path === 'index.html' && b.button === 'Applied'), 'the block reads Applied')
await page.screenshot({ path: '../build/renders/ai_applied.png' })

// two files at once: Apply all
await page.click('.ai-harness .ai-composer textarea')
await page.keyboard.type('Now change two files: in style.css add a rule that makes the footer grey and centred, and in index.html set the footer text to "Made in the office". Give back both files.')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelectorAll('.ai-harness .ai-answer').length === 2, null, { timeout: 10000 })
await page.waitForFunction(() => !document.querySelector('.ai-harness .ai-busy'), null, { timeout: 40000 })
// (the last answer's blocks and buttons: an earlier answer may carry files, and an Apply all, of its own)
const last = () => page.evaluate(() => {
  const a = [...document.querySelectorAll('.ai-harness .ai-answer')].pop()
  return {
    blocks: [...a.querySelectorAll('.ai-block')].map((b) => ({ path: b.querySelector('.ai-block-path')?.textContent ?? null, button: (b.querySelector('.ai-apply') ?? b.querySelector('.ai-applied'))?.textContent ?? null })),
    applyAll: a.querySelector('.ai-all')?.textContent ?? null, error: a.classList.contains('ai-error'),
  }
})
const two = await last(); console.log('two files:', two)
check(!two.error && two.blocks.filter((b) => b.button === 'Apply').length >= 2, 'two file blocks with Apply')
check(/^Apply all \(\d+ files\)$/.test(two.applyAll ?? ''), `the Apply all button: "${two.applyAll}"`)
const css0 = await page.evaluate(() => window.__workspace.read('style.css'))
await page.locator('.ai-harness .ai-answer').last().locator('.ai-all').click(); await page.waitForTimeout(300)
const [css1, html1] = await page.evaluate(() => [window.__workspace.read('style.css'), window.__workspace.read('index.html')])
console.log('style.css now:', JSON.stringify(css1.slice(-160)), '\nindex.html footer:', JSON.stringify(/<footer[\s\S]*?<\/footer>/i.exec(html1)?.[0] ?? null))
check(css1 !== css0 && /footer/i.test(css1) && /made in the office/i.test(html1), 'Apply all wrote style.css and index.html')
const all = await last(); console.log('after Apply all:', all.blocks)
check(all.blocks.every((b) => b.button === 'Applied'), 'every block of the answer reads Applied')
await page.screenshot({ path: '../build/renders/ai_apply_all.png' })

// Stop: the answer is cut short, no error, the keys come back
await page.click('.ai-harness .ai-composer textarea'); await page.keyboard.type('Explain this project in detail, file by file.'); await page.keyboard.press('Enter')
await page.waitForSelector('.ai-harness .ai-stop', { timeout: 5000 }); await page.waitForTimeout(900)
await page.click('.ai-harness .ai-stop'); await page.waitForTimeout(400)
const stopped = await panel(); console.log('stopped:', { busy: stopped.busy, error: stopped.error, answers: stopped.answers.length })
check(!stopped.busy && !stopped.error, 'Stop ends the answer without an error')
await page.screenshot({ path: '../build/renders/ai_stopped.png' })

if (errors.length) console.log('page errors:', errors)
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
