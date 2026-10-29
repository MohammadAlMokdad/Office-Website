// The AI panel's side of /api/chat (api/_chat.ts, preset 'code'): the model's name, an answer streamed in with the
// workspace's files as context, and the file blocks in an answer (```html path=index.html ... ```): the files the
// model hands back whole, for the panel to apply to the workspace.
import { type Files, FOLDER, normalizePath } from './workspace'

export type Info = { provider: string; label: string; brand: 'claude' | 'own'; ready: boolean }
export type Msg = { role: 'user' | 'assistant'; content: string }
export type FileBlock = { path: string; lang: string; code: string; closed: boolean }

export const CONTEXT_CHARS = 60_000 // the server's cap on the workspace sent along (api/_chat.ts): trimmed here too

/** Which model answers and under what name (Claude's only when a Claude model is connected). */
export const modelInfo = (): Promise<Info> => fetch('/api/chat').then((r) => r.json() as Promise<Info>)

/** The workspace for a request, CONTEXT_CHARS in all: the biggest files lose their ends first (each gets an equal
 *  share of what the smaller ones leave), and `cut` tells the server, and so the model, their real lengths. The server
 *  cuts the same way (api/_chat.ts). */
export function context(files: Files, cap = CONTEXT_CHARS) {
  const entries = Object.entries(files).sort((a, b) => a[1].length - b[1].length)
  const out: Files = {}, cut: Record<string, number> = {}
  let left = cap
  entries.forEach(([path, text], i) => {
    const share = Math.floor(left / (entries.length - i))
    if (text.length > share) { cut[path] = text.length; text = text.slice(0, share) }
    left -= text.length
    out[path] = text
  })
  return Object.keys(cut).length ? { files: out, cut } : { files: out }
}

/** Ask, with the chat so far and the workspace; the answer streams through `onText` (the whole text so far) and comes
 *  back complete. Throws with the server's words when it cannot answer. */
export async function ask(messages: Msg[], files: Files, { signal, onText }: { signal?: AbortSignal; onText?: (text: string) => void } = {}) {
  const r = await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ preset: 'code', messages, context: context(files) }),
  })
  if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Something went wrong.')
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += value
    onText?.(text)
  }
  if (!text) throw new Error('No answer came back.')
  return text
}

/** The path in a block's info string ('html path=index.html'; quoted, or file= / title=, also accepted), cleaned the
 *  way the workspace cleans paths; '' when there is none. */
export function filePath(info: string | undefined) {
  const m = /(?:^|\s)(?:path|file|filename|title)=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(info ?? '')
  if (!m) return ''
  let p = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/^\.\//, '')
  if (p === FOLDER || p.startsWith(`${FOLDER}/`)) p = p.slice(FOLDER.length + 1)
  return normalizePath(p)
}

/** The fenced code blocks of an answer that carry a path: the files to apply. `closed`: the block has its closing
 *  fence (while an answer streams in, the last one may not yet). The fences are read as react-markdown reads them, so
 *  the panel can tell which of the blocks it shows is which. */
export function fileBlocks(markdown: string): FileBlock[] {
  const out: FileBlock[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*(.*)$/.exec(lines[i])
    if (!open) continue
    const [, fence, first, rest] = open
    if (fence[0] === '`' && rest.includes('`')) continue // (not a fence: a backtick in its info string)
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \t]*$`)
    const indent = new RegExp(`^ {0,${lines[i].length - lines[i].trimStart().length}}`) // an indented fence: its lines lose as much
    const body: string[] = []
    let closed = false, j = i + 1
    for (; j < lines.length; j++) {
      if (close.test(lines[j])) { closed = true; break }
      body.push(lines[j].replace(indent, ''))
    }
    const path = filePath(`${first} ${rest}`)
    if (path) out.push({ path, lang: first.includes('=') ? '' : first, code: body.join('\n'), closed })
    i = j
  }
  return out
}
