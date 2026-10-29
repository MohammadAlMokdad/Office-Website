// One PNG -> KTX2 (Basis Universal), in its own process: the WASM encoder's heap does not survive several 4K
// encodes in one process.   node encode_one.mjs <in.png> <out.ktx2> '<options json>'
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeToKTX2 } from 'ktx2-encoder'
import { PNG } from 'pngjs'

const [src, dst, json] = process.argv.slice(2)
const decode = async (b) => {
  const p = PNG.sync.read(Buffer.from(b))
  return { width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) }
}
const log = console.log
console.log = () => {} // the encoder prints every slice
// the defaults first, so the options passed in win (data textures switch the sRGB transfer function off)
const data = await encodeToKTX2(new Uint8Array(readFileSync(src)), {
  generateMipmap: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, isKTX2File: true, ...JSON.parse(json), imageDecoder: decode,
})
console.log = log
writeFileSync(dst, data)
console.log(data.length)
