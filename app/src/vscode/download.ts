// Download the workspace as a zip (my-app.zip with a my-app/ folder inside), made in the browser with fflate and
// handed over through a temporary link: the real DOM, so it works from the page on the laptop's screen too.
import { strToU8, zipSync } from 'fflate'
import { FOLDER, workspace } from './workspace'

export function downloadZip() {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(workspace.files())) entries[`${FOLDER}/${path}`] = strToU8(text)
  const data = zipSync(entries, { level: 6 })
  const url = URL.createObjectURL(new Blob([data.slice()], { type: 'application/zip' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${FOLDER}.zip` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
