// Salah's right monitor (the curved one): a chat app with claude.ai's look (rail, greeting, composer, message style,
// colours, type).
// The server (api/_chat.ts) says which model and look to show: Claude's name and mark when a Claude model is connected
// (or, on this computer only, as a preview of it), any other model under its own name. The answers stream from there.
// The model menu lists the models of that look; picking one changes the name shown, not (yet) the model answering.
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sfx } from './sfx'

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean }
type Info = { provider: string; label: string; brand: 'claude' | 'own'; ready: boolean }

const USER = 'Salah'
const CLAUDE_MODELS = [
  { name: 'Claude Fable 5.1', note: 'Most capable, for ambitious work' },
  { name: 'Claude Opus 5.5', note: 'Deep thinking for complex tasks' },
  { name: 'Claude Sonnet 5.5', note: 'Smart and fast for everyday tasks' },
  { name: 'Claude Haiku 5.5', note: 'Fastest for quick answers' },
]
const hour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Beirut', hour: 'numeric', hour12: false }).format(new Date()))
function greeting() {
  const h = hour()
  return h < 5 ? `Hello, night owl` : h < 12 ? `Good morning, ${USER}` : h < 18 ? `Good afternoon, ${USER}` : `Good evening, ${USER}`
}

// Claude's mark (shown only when a Claude model answers) and a plain sparkle for any other model
const ClaudeMark = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <g stroke="#d97757" strokeWidth="2.4" strokeLinecap="round">
      {[[0, 9.5], [33, 8], [62, 10], [95, 8.5], [128, 9.8], [160, 7.6], [192, 9.6], [225, 8.2], [258, 10], [290, 8], [323, 9.2]].map(([a, r]) => (
        <line key={a} x1="12" y1="12" x2={12 + r * Math.cos((a * Math.PI) / 180)} y2={12 + r * Math.sin((a * Math.PI) / 180)} />
      ))}
    </g>
  </svg>
)
const Sparkle = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2c.6 4.6 2.4 7.4 10 10-7.6 2.6-9.4 5.4-10 10-.6-4.6-2.4-7.4-10-10 7.6-2.6 9.4-5.4 10-10z" fill="#d97757" />
  </svg>
)
const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const I = {
  plus: 'M12 5v14M5 12h14',
  chats: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  tools: 'M4 6h10M4 12h16M4 18h7M17 4v4M9 10v4M14 16v4',
  up: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  retry: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  chevron: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-10',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  cap: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  cup: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17',
}

export function ChatApp() {
  const [info, setInfo] = useState<Info | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const stop = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [picked, setPicked] = useState<string | null>(null) // the model chosen in the menu (shown only, for now)
  const [menu, setMenu] = useState(false)
  const picker = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/chat').then((r) => r.json()).then(setInfo).catch(() => setInfo({ provider: 'none', label: 'Offline', brand: 'own', ready: false }))
  }, [])
  const claude = info?.brand === 'claude'
  const name = claude ? 'Claude' : info?.label ?? 'Assistant'
  const Mark = claude ? ClaudeMark : Sparkle
  const models = claude ? CLAUDE_MODELS : [{ name: info?.label ?? '…', note: 'The model answering here' }]
  const model = picked ?? info?.label ?? '…'
  useEffect(() => { // a click anywhere else closes the menu
    if (!menu) return
    const close = (e: MouseEvent) => { if (!picker.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [messages])
  useEffect(() => { // the text box grows with what you type (up to a few lines)
    const t = box.current
    if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 150)}px` }
  }, [draft])

  const ask = useCallback(async (history: Msg[]) => {
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    const abort = new AbortController(); stop.current = abort
    let answer = ''
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      })
      if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Something went wrong.')
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        answer += value
        setMessages([...history, { role: 'assistant', content: answer }])
      }
      if (!answer) throw new Error('No answer came back.')
      sfx.play('confirm')
    } catch (e) {
      if (!abort.signal.aborted) { setMessages([...history, { role: 'assistant', content: (e as Error).message, error: true }]); sfx.play('error') }
    } finally {
      setBusy(false); stop.current = null
    }
  }, [])

  const send = (text = draft) => {
    const t = text.trim()
    if (!t || busy) return
    sfx.play('send')
    setDraft('')
    ask([...messages, { role: 'user', content: t }])
  }
  const retry = () => {
    const last = messages.map((m) => m.role).lastIndexOf('user')
    if (last >= 0 && !busy) ask(messages.slice(0, last + 1))
  }

  const composer = (
    <div className="ch-composer">
      <textarea
        ref={box} rows={1} value={draft} spellCheck={false}
        placeholder={messages.length ? `Reply to ${name}…` : 'How can I help you today?'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
      />
      <div className="ch-tools">
        <button className="ch-ghost" title="Add files"><Icon d={I.plus} /></button>
        <button className="ch-ghost" title="Tools"><Icon d={I.tools} /></button>
        <span className="ch-spacer" />
        <div className="ch-picker" ref={picker}>
          <button className="ch-model" onClick={() => setMenu(!menu)}>{model}<Icon d={I.chevron} size={14} /></button>
          {menu && (
            <div className="ch-menu">
              {models.map((m) => (
                <button key={m.name} onClick={() => { setPicked(m.name); setMenu(false) }}>
                  <span><b>{m.name}</b><small>{m.note}</small></span>
                  {m.name === model && <Icon d={I.check} size={16} />}
                </button>
              ))}
            </div>
          )}
        </div>
        {busy
          ? <button className="ch-send" title="Stop" onClick={() => stop.current?.abort()}><Icon d={I.stop} size={16} /></button>
          : <button className="ch-send" title="Send" disabled={!draft.trim()} onClick={() => send()}><Icon d={I.up} size={18} /></button>}
      </div>
    </div>
  )

  return (
    <div className="ch">
      <nav className="ch-rail">
        <span className="ch-rail-mark"><Mark size={22} /></span>
        <button className="ch-new" title="New chat" onClick={() => { stop.current?.abort(); setMessages([]); setDraft('') }}><Icon d={I.plus} size={16} /></button>
        <button className="ch-ghost" title="Chats"><Icon d={I.chats} /></button>
        <button className="ch-ghost" title="Projects"><Icon d={I.folder} /></button>
        <span className="ch-spacer" />
        <span className="ch-avatar">{USER[0]}</span>
      </nav>
      {messages.length === 0 ? (
        <main className="ch-home">
          <h1><Mark size={34} />{greeting()}</h1>
          {composer}
          <div className="ch-chips">
            <button onClick={() => setDraft('Help me write ')}><Icon d={I.pen} size={15} />Write</button>
            <button onClick={() => setDraft('Teach me about ')}><Icon d={I.cap} size={15} />Learn</button>
            <button onClick={() => setDraft('Help me with this code: ')}><Icon d={I.code} size={15} />Code</button>
            <button onClick={() => setDraft('Give me advice on ')}><Icon d={I.cup} size={15} />Life stuff</button>
            <button onClick={() => send('Surprise me with something interesting about Beirut.')}><Mark size={15} />{claude ? 'Claude’s choice' : 'Surprise me'}</button>
          </div>
          {info && !info.ready && <p className="ch-note">The chat isn’t connected yet.</p>}
        </main>
      ) : (
        <main className="ch-chat">
          <header>{messages[0].content.slice(0, 60)}<Icon d={I.chevron} size={14} /></header>
          <div className="ch-list" ref={list}>
            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="ch-user"><span className="ch-avatar">{USER[0]}</span><div>{m.content}</div></div>
            ) : (
              <div key={i} className={m.error ? 'ch-answer ch-error' : 'ch-answer'}>
                {m.content ? <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown> : null}
                {busy && i === messages.length - 1
                  ? <span className="ch-thinking"><Mark size={22} /></span>
                  : (
                    <div className="ch-actions">
                      <button className="ch-ghost" title="Copy" onClick={() => navigator.clipboard?.writeText(m.content)}><Icon d={I.copy} size={15} /></button>
                      {i === messages.length - 1 && <button className="ch-ghost" title="Retry" onClick={retry}><Icon d={I.retry} size={15} /></button>}
                    </div>
                  )}
              </div>
            ))}
          </div>
          <div className="ch-dock">
            {composer}
            <p className="ch-disclaimer">{claude ? 'Claude' : 'AI'} can make mistakes. Please double-check responses.</p>
          </div>
        </main>
      )}
    </div>
  )
}
