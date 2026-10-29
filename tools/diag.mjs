import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()) })
page.on('console', (m) => { if (m.type() === 'error' || /warn/.test(m.type())) console.log('console', m.type(), m.text().slice(0, 300)) })
await page.goto('http://localhost:4173/?debug&noui')
await page.waitForFunction(() => (window.__office?.calls ?? 0) > 5, null, { timeout: 120000 })
const info = await page.evaluate(() => {
  const { gl, scene } = window.__three
  const out = []
  scene.traverse((o) => {
    if (!o.isMesh) return
    const m = o.material
    const u = m.uniforms
    const t = u?.map?.value
    out.push({ mesh: o.name, mat: m.name, type: m.type, map: t ? { w: t.image?.width, h: t.image?.height, format: t.format, type: t.type, cs: t.colorSpace, mips: t.mipmaps?.length, isCompressed: !!t.isCompressedTexture } : null, attrs: Object.keys(o.geometry.attributes) })
  })
  return { exts: gl.getContext().getSupportedExtensions().filter((e) => /compressed/.test(e)), meshes: out.slice(0, 8) }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
