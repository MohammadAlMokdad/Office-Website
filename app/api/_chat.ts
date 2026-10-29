// The chat behind Salah's screen (src/ChatApp.tsx) and the AI panel in VS Code on the laptops (src/vscode/AiPanel.tsx).
// Runs on Vercel as a function (api/chat.ts) and, for testing, inside the Vite dev / preview server (vite.config.ts).
// It holds the API key (never sent to the page), caps what a visitor can send, and streams the model's answer back as
// plain text.
//   GET  -> { provider, model, label, brand, ready }   (the page shows the model's name and look)
//   POST { messages: [{ role: 'user' | 'assistant', content }], preset?, context? } -> the answer, streamed
//        preset 'assistant' (default): a plain chat. 'code': a pair-programmer for the laptops' workspace, which comes
//        along as context: { files: { [path]: text }, cut?: { [path]: its full length } } (files the page already cut
//        short to fit); it answers with whole files in fenced blocks (```html path=index.html).
// Settings (environment): CHAT_PROVIDER (gemini), CHAT_MODEL, GEMINI_API_KEY, CHAT_PREVIEW_CLAUDE.
// CHAT_PREVIEW_CLAUDE=1 shows the screens as they will look on Claude Fable 5.1 before Claude is connected (Claude's
// name and mark on Salah's chat and in VS Code's chat): set here and on Vercel for the demo (2026-10-23, the user's
// choice).

// read on every request (the local server loads .env.local after this module)
const settings = () => ({
  provider: process.env.CHAT_PROVIDER ?? 'gemini',
  model: process.env.CHAT_MODEL ?? 'gemini-3.5-flash-lite', // Google's newest Flash-Lite: its cheapest tier
  key: process.env.GEMINI_API_KEY,
  previewClaude: process.env.CHAT_PREVIEW_CLAUDE === '1', // the demo shows Claude's name and mark (set on Vercel too)
})
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_MESSAGES = 20 // the last ones only
const MAX_CHARS = 4000 // per message
const MAX_CHARS_CODE = 12_000 // the last user message of a 'code' request (it may quote files)
const MAX_OUTPUT_TOKENS = 1024, MAX_OUTPUT_TOKENS_CODE = 4096 // ('code': whole files)
const CONTEXT_CHARS = 60_000, CONTEXT_FILES = 200 // the workspace sent with a 'code' request, in all
const MAX_BODY = 1_000_000 // bytes: a few messages and a small workspace
const PER_MINUTE = 8, PER_DAY = 100 // per visitor (per IP, per server instance)

type Message = { role: 'user' | 'assistant'; content: string }
type Preset = 'assistant' | 'code'
type Files = Record<string, string>

// a plain assistant: nothing about the office or the website it is shown in
const system = (label: string) =>
  `You are Claude, an AI assistant made by Anthropic. Be helpful, friendly and concise; use Markdown when it helps. ` +
  `If asked who or what you are, say you are Claude by Anthropic.`

// a fence no run of backticks in the text can close
const fence = (text: string) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((s) => s.length + 1)))

// the laptops' pair-programmer: it has the workspace's files (src/vscode/workspace.ts) and hands files back whole, in
// blocks the page applies to the workspace with one click (src/vscode/AiPanel.tsx)
const codeSystem = (files: Files, cut: Record<string, number>) => {
  const paths = Object.keys(files).sort()
  const listing = paths.map((path) => {
    const text = files[path], f = fence(text)
    const note = cut[path] ? ` (cut short: the first ${text.length.toLocaleString('en')} of ${cut[path].toLocaleString('en')} characters)` : ''
    return `### ${path}${note}\n${f}${path.split('.').pop() ?? ''}\n${text}\n${f}`
  }).join('\n\n')
  return `You are an expert pair-programmer inside VS Code, working with the user on a small static web project: plain ` +
    `HTML, CSS and JavaScript files in one folder, opened straight in the browser (no build step, no server, no ` +
    `packages), index.html first, the files linked to each other by relative paths. TypeScript, Markdown, JSON or ` +
    `Python files there are just text to you.\n` +
    `Answer in Markdown and keep it short: a line or two on what you did or found, no long explanations unless asked. ` +
    `A question can be answered without touching any file.\n\n` +
    `THE RULE FOR FILES: whenever you write a new file or change one, give the COMPLETE file, first line to last, in ` +
    `one fenced code block whose info string is the language and the file's path, exactly like this:\n\n` +
    '```html path=index.html\n<!doctype html>\n...the whole file...\n```\n\n' +
    `One block per file, the path relative to the project folder (no leading ./, no folder name, no quotes). Never a ` +
    `partial file, never a diff, never "unchanged parts omitted" or "rest as before": the user applies each block as ` +
    `the file's whole new contents with one click, so anything left out is lost. Change only the files the request ` +
    `needs and keep everything else in them as it is. Code that is only an example for the user, not a file to apply, ` +
    `goes in a plain fenced block without a path. A file marked "cut short" below is shown only in part: say what to ` +
    `change in it instead of rewriting it whole.\n\n` +
    `## Current workspace files\n` +
    (paths.length ? `The project folder as it is right now (what the user sees in the explorer): start from these.\n\n${listing}` : 'The project folder is empty.')
}

/** The workspace a 'code' request came with: text files only, CONTEXT_CHARS in all. Over that, the biggest files
 *  lose their ends (each gets an equal share of what the smaller ones leave); `cut` holds their full lengths, and
 *  those of the files the page cut short the same way before sending. */
function workspaceOf(raw: unknown, cutBefore: unknown) {
  const files: Files = {}, cut: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return { files, cut }
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[0].length <= 200).slice(0, CONTEXT_FILES)
    .sort((a, b) => a[1].length - b[1].length)
  let left = CONTEXT_CHARS
  entries.forEach(([path, text], i) => {
    const share = Math.floor(left / (entries.length - i))
    if (text.length > share) { cut[path] = text.length; text = text.slice(0, share) }
    left -= text.length
    files[path] = text
  })
  if (cutBefore && typeof cutBefore === 'object') {
    for (const [path, n] of Object.entries(cutBefore as Record<string, unknown>)) {
      if (path in files && typeof n === 'number' && n > files[path].length) cut[path] = Math.max(cut[path] ?? 0, n)
    }
  }
  return { files, cut }
}

const labels = new Map<string, string>()
async function modelLabel(model: string, key: string | undefined) {
  if (labels.has(model)) return labels.get(model)!
  if (!key) return 'Gemini'
  try {
    const r = await fetch(`${GEMINI}/models/${model}`, { headers: { 'x-goog-api-key': key } })
    if (!r.ok) return 'Gemini'
    labels.set(model, ((await r.json()) as { displayName?: string }).displayName ?? 'Gemini')
  } catch { return 'Gemini' }
  return labels.get(model)!
}

const seen = new Map<string, number[]>()
function allowed(ip: string) {
  const now = Date.now(), times = (seen.get(ip) ?? []).filter((t) => now - t < 86_400_000)
  if (times.filter((t) => now - t < 60_000).length >= PER_MINUTE || times.length >= PER_DAY) return false
  times.push(now); seen.set(ip, times)
  return true
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function handleChat(req: Request, ip: string): Promise<Response> {
  const { provider, model, key, previewClaude } = settings()
  if (req.method === 'GET') {
    const claude = provider === 'anthropic' || previewClaude
    return json({ provider, model, label: previewClaude ? 'Claude Fable 5.1' : await modelLabel(model, key), brand: claude ? 'claude' : 'own', ready: !!key })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!key) return json({ error: 'The chat is not connected yet (no API key on the server).' }, 503)
  if (!allowed(ip)) return json({ error: 'That’s a lot of messages: please wait a minute.' }, 429)

  let messages: Message[], preset: Preset = 'assistant', ctx = { files: {} as Files, cut: {} as Record<string, number> }
  try {
    if (Number(req.headers.get('content-length')) > MAX_BODY) return json({ error: 'That’s too much at once.' }, 413)
    const body = (await req.json()) as { messages?: Message[]; preset?: string; context?: { files?: unknown; cut?: unknown } }
    preset = body.preset === 'code' ? 'code' : 'assistant'
    messages = (body.messages ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_MESSAGES)
      .map((m, i, all) => ({ role: m.role, content: m.content.slice(0, preset === 'code' && i === all.length - 1 ? MAX_CHARS_CODE : MAX_CHARS) }))
    if (preset === 'code') ctx = workspaceOf(body.context?.files, body.context?.cut)
  } catch { return json({ error: 'Bad request' }, 400) }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'Nothing to answer' }, 400)

  const upstream = await fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: preset === 'code' ? codeSystem(ctx.files, ctx.cut) : system(await modelLabel(model, key)) }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: preset === 'code' ? MAX_OUTPUT_TOKENS_CODE : MAX_OUTPUT_TOKENS },
    }),
  })
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    console.error('chat: upstream', upstream.status, detail.slice(0, 500))
    return json({ error: upstream.status === 429 ? 'The model is busy right now: try again in a moment.' : 'The model could not answer.' }, 502)
  }

  // Gemini's server-sent events -> just the text
  const decoder = new TextDecoder(), encoder = new TextEncoder()
  let buffer = ''
  const text = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      buffer += decoder.decode(chunk, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
        if (!data) continue
        try {
          const parts = (JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
            .candidates?.[0]?.content?.parts ?? []
          const piece = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('')
          if (piece) out.enqueue(encoder.encode(piece))
        } catch { /* a partial event: skipped */ }
      }
    },
  }))
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}
