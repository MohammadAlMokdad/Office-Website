// Decode sound files in headless Chrome and report their length, peak, and the hits in them (onsets above -30 dB of
// the peak with the quiet gap before each), to trim recordings to single events.   node sfx_probe.mjs <dir> <files...>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const [dir, ...files] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.goto('about:blank')
for (const f of files) {
  const b64 = readFileSync(join(dir, f)).toString('base64')
  const r = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(bin.buffer)
    const d = buf.getChannelData(0), sr = buf.sampleRate
    const win = Math.round(sr * 0.005) // 5 ms RMS windows
    const rms = []
    for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += d[j] * d[j]; rms.push(Math.sqrt(s / win)) }
    const peak = Math.max(...rms)
    const thr = peak * 0.0316 // -30 dB
    const hits = []
    let inHit = false, quiet = 0
    for (let i = 0; i < rms.length; i++) {
      if (!inHit && rms[i] > thr && quiet >= 8) { hits.push({ at: +(i * 0.005).toFixed(3), peak: 0 }); inHit = true }
      if (inHit) { hits[hits.length - 1].peak = Math.max(hits[hits.length - 1].peak, rms[i]); if (rms[i] < thr) { quiet++; if (quiet >= 16) { inHit = false; hits[hits.length - 1].end = +(i * 0.005).toFixed(3) } } else quiet = 0 }
      else quiet = rms[i] < thr ? quiet + 1 : 0
    }
    return { seconds: +buf.duration.toFixed(2), sr, channels: buf.numberOfChannels, peakDb: +(20 * Math.log10(peak)).toFixed(1), hits: hits.map((h) => ({ at: h.at, end: h.end ?? +buf.duration.toFixed(2), peakDb: +(20 * Math.log10(h.peak)).toFixed(1) })) }
  }, b64)
  console.log(f, JSON.stringify(r))
}
await browser.close()
