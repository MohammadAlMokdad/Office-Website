// Size/quality experiment: encode some textures as ETC1S into build/etc1s_test/ (the app keeps its own files).
//   node etc1s_test.mjs Floor IslandAli WindowView
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeToKTX2 } from 'ktx2-encoder'
import { PNG } from 'pngjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'etc1s_test')
mkdirSync(OUT, { recursive: true })
const decode = async (b) => { const p = PNG.sync.read(Buffer.from(b)); return { width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) } }
for (const name of process.argv.slice(2)) {
  const src = join(ROOT, 'build', 'textures', `${name}.png`)
  const quiet = console.log; console.log = () => {}
  const t = Date.now()
  const data = await encodeToKTX2(new Uint8Array(readFileSync(src)), {
    isUASTC: false, qualityLevel: 255, compressionLevel: 2, generateMipmap: true, isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true, isKTX2File: true, imageDecoder: decode,
  })
  console.log = quiet
  writeFileSync(join(OUT, `${name}.ktx2`), data)
  const uastc = join(ROOT, 'app', 'public', 'models', 'textures', `${name}.ktx2`)
  console.log(`${name}: ETC1S ${(data.length / 1e6).toFixed(2)} MB vs UASTC ${(statSync(uastc).size / 1e6).toFixed(2)} MB (${((Date.now() - t) / 1000).toFixed(0)}s)`)
}
