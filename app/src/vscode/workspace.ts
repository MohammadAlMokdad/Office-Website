// The one workspace both laptops (Mhmd's and Zuhair's) edit: a folder of text files, kept in the browser
// (localStorage) so a reload keeps the work. Every change notifies subscribers with who made it (`origin`), so an
// editor showing the same file on the other laptop can update itself without echoing the change back.
export type Files = Record<string, string> // path (folders with '/', no leading slash) -> text
export type Change = { type: 'write' | 'create' | 'remove' | 'rename' | 'reset'; path: string; to?: string; origin?: string }

export const FOLDER = 'my-app' // the folder's name (the zip you download is <FOLDER>.zip with this folder inside)
const KEY = 'office.workspace.v1'
const MAX_FILES = 200, MAX_CHARS = 2_000_000

export const DEFAULT_FILES: Files = {
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Hello from the office 👋</h1>
      <p>Edit <code>index.html</code>, <code>style.css</code> or <code>app.js</code>, then press <b>Run</b>.</p>
      <button id="count">Clicked 0 times</button>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
  'style.css': `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}
main { text-align: center; }
button {
  padding: 10px 18px;
  border: 0;
  border-radius: 8px;
  background: #38bdf8;
  color: #0f172a;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
`,
  'app.js': `const button = document.getElementById('count')
let clicks = 0
button.addEventListener('click', () => {
  clicks += 1
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? '' : 's'}\`
  console.log('clicks:', clicks)
})
console.log('app.js loaded')
`,
  'README.md': `# My App

A small web app. Open the files on the left, change them, and press **Run** to see it in the browser.
Ask the AI in the sidebar to write code for you. **Download** gives you this folder as a zip.
`,
}

let files: Files = load()
let version = 0
const listeners = new Set<(c: Change) => void>()
let saveTimer = 0

function load(): Files {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { files?: Files }
      if (parsed.files && typeof parsed.files === 'object' && Object.keys(parsed.files).length) return { ...parsed.files }
    }
  } catch { /* no storage, or a bad value: start fresh */ }
  return { ...DEFAULT_FILES }
}
function save() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ files })) } catch { /* full or blocked */ } }, 300)
}
function emit(c: Change) { version++; save(); listeners.forEach((f) => f(c)) }

/** A clean relative path: 'src/app.js'. Empty if the name is not usable. */
export function normalizePath(p: string) {
  const parts = p.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean)
  if (!parts.length || parts.some((s) => s === '.' || s === '..')) return ''
  return parts.join('/')
}

export const workspace = {
  /** Every path, sorted (folders first within each directory is the explorer's job). */
  list: (): string[] => Object.keys(files).sort(),
  has: (path: string) => path in files,
  read: (path: string): string | undefined => files[path],
  files: (): Files => files,
  version: () => version,
  /** Write a file's text (creating it if new). `origin`: who did it (an editor's id), so it can ignore its own echo. */
  write(path: string, content: string, origin?: string) {
    path = normalizePath(path)
    if (!path) return false
    if (!(path in files) && Object.keys(files).length >= MAX_FILES) return false
    if (content.length > MAX_CHARS) content = content.slice(0, MAX_CHARS)
    const isNew = !(path in files)
    if (!isNew && files[path] === content) return true
    files = { ...files, [path]: content }
    emit({ type: isNew ? 'create' : 'write', path, origin })
    return true
  },
  create(path: string, content = '', origin?: string) {
    path = normalizePath(path)
    if (!path || path in files) return false
    return workspace.write(path, content, origin)
  },
  remove(path: string, origin?: string) {
    if (!(path in files)) return false
    const next = { ...files }; delete next[path]; files = next
    emit({ type: 'remove', path, origin })
    return true
  },
  /** Remove a folder and everything in it. */
  removeFolder(folder: string, origin?: string) {
    const prefix = normalizePath(folder) + '/'
    const gone = Object.keys(files).filter((p) => p.startsWith(prefix))
    if (!gone.length) return false
    const next = { ...files }; gone.forEach((p) => delete next[p]); files = next
    gone.forEach((path) => emit({ type: 'remove', path, origin }))
    return true
  },
  rename(from: string, to: string, origin?: string) {
    to = normalizePath(to)
    if (!(from in files) || !to || to in files) return false
    const next = { ...files }; next[to] = next[from]; delete next[from]; files = next
    emit({ type: 'rename', path: from, to, origin })
    return true
  },
  /** Replace everything (e.g. "new project"). */
  reset(next: Files = DEFAULT_FILES, origin?: string) {
    files = { ...next }
    emit({ type: 'reset', path: '', origin })
  },
  subscribe(f: (c: Change) => void) { listeners.add(f); return () => { listeners.delete(f) } },
  /** For useSyncExternalStore: a value that changes on every change. */
  snapshot: () => version,
}

/** Folders in use (from the paths), e.g. 'src', 'src/lib'. */
export function folders(paths = workspace.list()): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out].sort()
}

export const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', xml: 'application/xml', ts: 'text/typescript', py: 'text/x-python',
}
export const mimeOf = (path: string) => MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'text/plain'

if (new URLSearchParams(window.location.search).has('debug')) Object.assign(window, { __workspace: workspace }) // tests
