// Runs the workspace in the laptop's browser window without a server: index.html with its stylesheets, scripts,
// images and module imports resolved to blob: URLs made from the workspace's files, plus a script at the top of
// <head> that forwards the page's console and errors to VS Code's terminal (postMessage to the parent window).
// Modules: a blob: URL has no folder to resolve './x.js' against, so imports between workspace files are rewritten to
// bare names ('my-app/x.js') that an import map points at the blobs; './x.js', 'x.js' and '/x.js' from an inline
// script in the page are mapped too.
import { FOLDER, mimeOf, workspace } from './workspace'

export type Built = {
  html: string // the document for the iframe's srcdoc
  title: string // its <title>, or the file's name
  entry: string | null // the html file run (null: there is none in the workspace)
  names: Map<string, string> // blob URL -> file path (errors from the page name blob URLs)
  revoke: () => void // free the blobs (before the next build)
}
export type PreviewMessage = { source: typeof SOURCE; id: string; type: 'log' | 'info' | 'warn' | 'error' | 'debug'; text: string }

export const SOURCE = 'vsc-preview'
export const PREVIEW_URL = 'http://localhost:3000/' // what the browser's address bar reads
const PREFIX = `${FOLDER}/` // the bare names in the import map

/** The workspace file `ref` names from the folder `from` ('' = the root): './x', '../x', '/x' (from the root) or 'x'.
 *  Null: a URL, or not a file in the workspace. */
function resolve(from: string, ref: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(ref)) return null // http:, data:, mailto:, an anchor
  const clean = ref.split(/[?#]/)[0]
  if (!clean) return null
  const parts = clean.startsWith('/') || !from ? [] : from.split('/')
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (!parts.length) return null; parts.pop() }
    else parts.push(seg)
  }
  const path = parts.join('/')
  return workspace.has(path) ? path : null
}
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const isJs = (p: string) => /\.(m?js|cjs|jsx)$/i.test(p)
const isCss = (p: string) => /\.css$/i.test(p)
const isHtml = (p: string) => /\.html?$/i.test(p)

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g // url(...) in CSS, quoted or not
const FROM = /(\bfrom\s*)(['"])([^'"\n]+)\2/g // import x from '...', export * from '...'
const IMPORT = /(\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g // import '...', import('...')
const TAGS = /<(link|script|img|video|audio|source|iframe|embed)\b([^>]*)>/gi // the tags that load files
const ATTR = /(\s(?:src|href)\s*=\s*)(["']?)([^"'\s>]+)\2/gi
const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi
const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi

const forwarder = (id: string) => `<script>(function(){var ID=${JSON.stringify(id)},SRC=${JSON.stringify(SOURCE)};
function fmt(a){if(typeof a==='string')return a;if(a instanceof Error)return a.stack||String(a);if(a&&typeof a==='object'){try{return JSON.stringify(a)}catch(e){}}return String(a)}
function post(type,args){try{parent.postMessage({source:SRC,id:ID,type:type,text:args.map(fmt).join(' ')},'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(k){var o=console[k];console[k]=function(){post(k,[].slice.call(arguments));if(o)o.apply(console,arguments)}});
window.addEventListener('error',function(e){var m=e.message||'Uncaught error';post('error',[(/^Uncaught/.test(m)?'':'Uncaught ')+m+(e.filename?' ('+e.filename+':'+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){post('error',['Uncaught (in promise) '+fmt(e.reason)])});
})()</script>`

const NOTHING = `<!doctype html><html><head><meta charset="utf-8"><title>No index.html</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;color:#333;background:#fff}p{max-width:36em;text-align:center}code{padding:1px 5px;border-radius:4px;background:#eee}</style>
</head><body><p>There is no <code>index.html</code> in <code>${FOLDER}</code> yet.<br>Create one and press Run again.</p></body></html>`

/** Build the page for a laptop's browser; `id` names the laptop in the console messages the page sends back. */
export function build(id: string): Built {
  const files = workspace.files()
  const paths = Object.keys(files).sort()
  const entry = paths.includes('index.html') ? 'index.html' : paths.find(isHtml) ?? null
  const urls = new Map<string, string>() // path -> blob URL
  const names = new Map<string, string>()
  const blob = (path: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mimeOf(path) }))
    urls.set(path, url); names.set(url, path)
    return url
  }
  const href = (from: string, ref: string) => { const p = resolve(from, ref); return p ? urls.get(p) : undefined }
  const bare = (from: string, ref: string) => { const p = resolve(from, ref); return p && isJs(p) ? `${PREFIX}${p}` : null }
  const modules = (from: string, js: string) => js
    .replace(FROM, (m, pre: string, q: string, ref: string) => { const b = bare(from, ref); return b ? `${pre}${q}${b}${q}` : m })
    .replace(IMPORT, (m, pre: string, q: string, ref: string) => { const b = bare(from, ref); return b ? `${pre}${q}${b}${q}` : m })
  const styles = (from: string, css: string) => css.replace(CSS_URL, (m, q: string, ref: string) => { const u = href(from, ref); return u ? `url(${q}${u}${q})` : m })

  // 1. images, fonts, data: as they are; 2. stylesheets, their url(...) pointing at those; 3. scripts, their imports
  // of other workspace modules as bare names
  for (const p of paths) if (!isHtml(p) && !isCss(p) && !isJs(p)) blob(p, files[p])
  for (const p of paths) if (isCss(p)) blob(p, styles(folderOf(p), files[p]))
  for (const p of paths) if (isJs(p)) blob(p, modules(folderOf(p), files[p]))
  const imports: Record<string, string> = {}
  for (const p of paths) if (isJs(p)) { const u = urls.get(p)!; imports[`./${p}`] = u; imports[`/${p}`] = u; imports[p] = u; imports[`${PREFIX}${p}`] = u }

  // 4. the page: what its tags load, url(...) in its <style>s, imports in its scripts
  let html = entry ? files[entry] : NOTHING
  const from = entry ? folderOf(entry) : ''
  html = html
    .replace(TAGS, (_, name: string, attrs: string) => `<${name}${attrs.replace(ATTR, (a, pre: string, _q: string, ref: string) => { const u = href(from, ref); return u ? `${pre}"${u}"` : a })}>`)
    .replace(STYLE, (_, open: string, css: string, close: string) => open + styles(from, css) + close)
    .replace(SCRIPT, (_, open: string, js: string, close: string) => open + modules(from, js) + close)
  const head = forwarder(id) + `<script type="importmap">${JSON.stringify({ imports })}</script>`
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (m) => m + head)
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${head}</head>`)
  else html = head + html
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, ' ').trim() || entry || 'Untitled'
  return { html, title, entry, names, revoke: () => { for (const u of urls.values()) URL.revokeObjectURL(u) } }
}

/** A console line from a preview page (the message event's data), for this laptop; else null. */
export function previewMessage(data: unknown, id: string): PreviewMessage | null {
  const m = data as Partial<PreviewMessage> | null
  return m && typeof m === 'object' && m.source === SOURCE && m.id === id && typeof m.text === 'string' ? (m as PreviewMessage) : null
}
