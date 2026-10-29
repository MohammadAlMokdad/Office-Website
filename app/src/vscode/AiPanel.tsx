// The AI chat in VS Code's secondary side bar on the laptops: Copilot Chat's look (Dark Modern) with the same model
// behind it as Salah's chat (/api/chat, api/_chat.ts, preset 'code'). Every request carries the workspace's files
// (workspace.ts); the answer streams in, and each file block in it (```html path=index.html) gets an Apply button that
// writes the file to the workspace, where the explorer and the editor of both laptops follow, and opens it
// (`onOpenFile`). The server says which model answers; Claude's name and mark show only when a Claude model does (the
// rule of ChatApp.tsx), any other model under its own name with a plain sparkle.
import { type JSX, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ask, type FileBlock, fileBlocks, filePath, type Info, modelInfo } from './aiClient'
import { FOLDER, workspace } from './workspace'
import './ai.css'
import { sfx } from '../sfx'

export type AiPanelProps = { laptop: 'mhmd' | 'zuhair'; user: string; onOpenFile?: (path: string) => void }
type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean }
type Apply = (path: string, code: string) => void
type PreProps = JSX.IntrinsicElements['pre'] & ExtraProps
type MarkType = (props: { size?: number }) => JSX.Element

const MAX_BOX_PX = 160 // the text box grows with what you type, up to this
const CHIPS: { icon: keyof typeof I; label: string; text: string }[] = [ // the welcome screen's ideas: they fill the box
  { icon: 'layout', label: 'Build a landing page', text: 'Build a landing page for a small coffee shop: a hero with a headline and a button, a menu section, opening hours and a footer.' },
  { icon: 'moon', label: 'Add a dark mode toggle', text: 'Add a dark mode toggle button to the page and remember the choice between visits.' },
  { icon: 'book', label: 'Explain this project', text: 'Explain this project: what each file does and how they fit together.' },
  { icon: 'bug', label: 'Fix a bug', text: 'Fix a bug: ' },
]

// Claude's mark (only when a Claude model answers) and a plain sparkle for any other model, as on Salah's screen
const ClaudeMark: MarkType = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <g stroke="#d97757" strokeWidth="2.4" strokeLinecap="round">
      {[[0, 9.5], [33, 8], [62, 10], [95, 8.5], [128, 9.8], [160, 7.6], [192, 9.6], [225, 8.2], [258, 10], [290, 8], [323, 9.2]].map(([a, r]) => (
        <line key={a} x1="12" y1="12" x2={12 + r * Math.cos((a * Math.PI) / 180)} y2={12 + r * Math.sin((a * Math.PI) / 180)} />
      ))}
    </g>
  </svg>
)
const Sparkle: MarkType = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2c.6 4.6 2.4 7.4 10 10-7.6 2.6-9.4 5.4-10 10-.6-4.6-2.4-7.4-10-10 7.6-2.6 9.4-5.4 10-10z" fill="#4daafc" />
  </svg>
)
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const I = {
  plus: 'M12 5v14M5 12h14',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12l5 5 9-10',
  chevron: 'M6 9l6 6 6-6',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  attach: 'M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.3 3.3 0 0 1 4.7 4.7L10.5 18a1.7 1.7 0 0 1-2.4-2.4L16 7.7',
  layout: 'M4 5h16v14H4zM4 10h16M9 10v9',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  bug: 'M9 9V7a3 3 0 0 1 6 0v2M5 9h14M6 9v5a6 6 0 0 0 12 0V9M4 14h2M18 14h2M5 19l2-2M19 19l-2-2',
}

export function AiPanel({ laptop, user, onOpenFile }: AiPanelProps) {
  const [info, setInfo] = useState<Info | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const stop = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  useSyncExternalStore(workspace.subscribe, workspace.snapshot) // (a block reads "Applied" once the workspace has it)

  useEffect(() => {
    modelInfo().then(setInfo).catch(() => setInfo({ provider: 'none', label: 'Offline', brand: 'own', ready: false }))
  }, [])
  const claude = info?.brand === 'claude'
  const name = claude ? 'Claude' : info?.label ?? 'AI'
  const Mark = claude ? ClaudeMark : Sparkle

  const follow = useRef(true) // the list follows the answer coming in, unless you scrolled up to read
  useEffect(() => {
    const l = list.current
    if (l && follow.current) l.scrollTop = l.scrollHeight
  }, [messages])
  const scrolled = () => { const l = list.current; if (l) follow.current = l.scrollHeight - l.scrollTop - l.clientHeight < 60 }
  useEffect(() => { // the text box grows with what you type (up to a few lines)
    const t = box.current
    if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, MAX_BOX_PX)}px` }
  }, [draft])

  const run = useCallback(async (history: Msg[]) => {
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    const abort = new AbortController(); stop.current = abort
    let answer = '', error = '', frame = 0
    const show = () => { frame = 0; setMessages([...history, { role: 'assistant', content: answer }]) }
    try {
      answer = await ask(history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })), workspace.files(), {
        signal: abort.signal,
        onText: (text) => { answer = text; if (!frame) frame = requestAnimationFrame(show) }, // (one update a frame)
      })
    } catch (e) {
      if (!abort.signal.aborted) { answer = ''; error = (e as Error).message } // (Stop keeps what came so far)
    }
    cancelAnimationFrame(frame)
    if (!abort.signal.aborted) sfx.play(error ? 'error' : 'confirm')
    setMessages(error ? [...history, { role: 'assistant', content: error, error: true }] : answer ? [...history, { role: 'assistant', content: answer }] : history)
    setBusy(false); stop.current = null
  }, [])

  const send = (text = draft) => {
    const t = text.trim()
    if (!t || busy) return
    sfx.play('send')
    setDraft('')
    follow.current = true
    run([...messages, { role: 'user', content: t }])
  }
  const fresh = () => { stop.current?.abort(); setMessages([]); setDraft(''); box.current?.focus() }
  const apply = useCallback<Apply>((path, code) => {
    if (workspace.write(path, code.endsWith('\n') ? code : `${code}\n`, `ai-${laptop}`)) onOpenFile?.(path)
  }, [laptop, onOpenFile])
  const count = workspace.list().length

  return (
    <div className="ai">
      <header className="ai-head">
        <span className="ai-title">Chat</span>
        <span className="ai-head-model" title="The model answering">{info?.label ?? ''}</span>
        <span className="ai-spacer" />
        <button className="ai-icon" title="New Chat" onClick={fresh}><Icon d={I.plus} /></button>
      </header>
      {messages.length === 0 ? (
        <div className="ai-welcome">
          <Mark size={40} />
          <h2>Ask {name} to write code</h2>
          <p>{name} reads the files in <code>{FOLDER}</code> and answers with whole files. Apply puts a file in the workspace, on both laptops.</p>
          <div className="ai-chips">
            {CHIPS.map((c) => <button key={c.label} onClick={() => { setDraft(c.text); box.current?.focus() }}><Icon d={I[c.icon]} size={14} />{c.label}</button>)}
          </div>
          {info && !info.ready && <p className="ai-note">The chat isn’t connected yet.</p>}
        </div>
      ) : (
        <div className="ai-list" ref={list} onScroll={scrolled}>
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} className="ai-msg ai-user">
              <div className="ai-who"><span className="ai-avatar">{user[0]}</span>{user}</div>
              <div className="ai-text">{m.content}</div>
            </div>
          ) : (
            <Answer key={i} content={m.content} error={!!m.error} streaming={busy && i === messages.length - 1} name={name} Mark={Mark} apply={apply} />
          ))}
        </div>
      )}
      <div className="ai-dock">
        <div className="ai-composer">
          <textarea
            ref={box} rows={1} value={draft} spellCheck={false} placeholder={`Ask ${name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          />
          <div className="ai-composer-row">
            <span className="ai-context" title={`${name} gets every file of the workspace with your message`}><Icon d={I.attach} size={12} />{FOLDER} · {count} {count === 1 ? 'file' : 'files'}</span>
            <span className="ai-spacer" />
            <span className="ai-model" title="The model answering">{info?.label ?? '…'}<Icon d={I.chevron} size={12} /></span>
            {busy
              ? <button className="ai-send ai-stop" title="Stop" onClick={() => stop.current?.abort()}><Icon d={I.stop} size={14} /></button>
              : <button className="ai-send" title="Send (Enter)" disabled={!draft.trim()} onClick={() => send()}><Icon d={I.send} size={15} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// one answer: Markdown, its file blocks with Apply (Block), and once it is complete Apply all and Copy
function Answer({ content, error, streaming, name, Mark, apply }: { content: string; error: boolean; streaming: boolean; name: string; Mark: MarkType; apply: Apply }) {
  const blocks = useMemo(() => (error ? [] : fileBlocks(content)), [content, error])
  const components = useMemo(() => ({
    pre: (p: PreProps) => <Block {...p} blocks={blocks} apply={apply} />,
    a: ({ node: _, ...p }: JSX.IntrinsicElements['a'] & ExtraProps) => <a {...p} target="_blank" rel="noreferrer" />, // (never away from the office)
  }), [blocks, apply])
  const files = useMemo(() => { // the complete files, one per path (the last block for a path wins)
    const last = new Map<string, FileBlock>()
    for (const b of blocks) if (b.closed) last.set(b.path, b)
    return [...last.values()]
  }, [blocks])
  return (
    <div className={error ? 'ai-msg ai-answer ai-error' : 'ai-msg ai-answer'}>
      <div className="ai-who"><Mark size={18} />{name}</div>
      <div className="ai-text">{error ? content : <Markdown remarkPlugins={[remarkGfm]} components={components}>{content}</Markdown>}</div>
      {streaming ? <span className="ai-busy"><i />Working…</span> : !error && (
        <div className="ai-actions">
          {files.length >= 2 && <button className="ai-all" onClick={() => files.forEach((b) => apply(b.path, b.code))}><Icon d={I.check} size={13} />Apply all ({files.length} files)</button>}
          <CopyButton text={content} />
        </div>
      )}
    </div>
  )
}

// a fenced code block: a header with the file's path, Apply (once the block is complete) and Copy; a plain block
// without a path only shows its language and Copy
function Block({ node, blocks, apply, ...rest }: PreProps & { blocks: FileBlock[]; apply: Apply }) {
  const first = node?.children[0]
  const el = first && first.type === 'element' && first.tagName === 'code' ? first : null
  const lang = String((el?.properties.className as string[] | undefined)?.[0] ?? '').replace(/^language-/, '')
  const path = filePath((el?.data as { meta?: string } | undefined)?.meta)
  const text = el ? el.children.map((c) => (c.type === 'text' ? c.value : '')).join('') : ''
  const block = blocks.find((b) => b.path === path && b.code === text) ?? [...blocks].reverse().find((b) => b.path === path)
  const applied = !!path && workspace.read(path) === (text.endsWith('\n') ? text : `${text}\n`)
  return (
    <div className="ai-block">
      <div className="ai-block-head">
        {path ? <><Icon d={I.file} size={13} /><span className="ai-block-path" title={path}>{path}</span></> : <span className="ai-block-lang">{lang}</span>}
        <span className="ai-spacer" />
        {path && (applied
          ? <span className="ai-applied"><Icon d={I.check} size={12} />Applied</span>
          : <button className="ai-apply" disabled={!block?.closed} title={block?.closed ? `Write ${path} to the workspace and open it` : 'Not complete yet'} onClick={() => apply(path, text)}>Apply</button>)}
        <CopyButton text={text} />
      </div>
      <pre {...rest} />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="ai-icon" title={done ? 'Copied' : 'Copy'} onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1200) }}>
      <Icon d={done ? I.check : I.copy} size={13} />
    </button>
  )
}

// A dev harness (tools/ai_check.mjs): with ?aipanel=1 the panel alone fills the page, over the office, so it can be
// tried and screenshotted before VS Code (VSCodeApp.tsx) is around it. Until VS Code imports this module, the check
// loads it by hand; nothing else of the app changes. (Once only: a hot reload runs this module again.)
if (new URLSearchParams(window.location.search).has('aipanel') && !document.querySelector('.ai-harness')) {
  const host = document.createElement('div')
  host.className = 'ai-harness'
  document.body.appendChild(host)
  createRoot(host).render(<AiPanel laptop="mhmd" user="Mhmd" />)
}
