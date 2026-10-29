// VS Code on a laptop's screen (Dark Modern's look): title bar, activity bar, the EXPLORER (Explorer.tsx) and the
// other views (Views.tsx), tabs, breadcrumbs and the editor (Editor.tsx), the panel with the terminal (Panel.tsx),
// the status bar, the AI chat as the secondary side bar (AiPanel.tsx) and, over it all when you Run, the browser
// window with the app (Browser.tsx, runner.ts). Both laptops show the same workspace (workspace.ts); `laptop` tells
// the two apart: their own open tabs, panel and browser, and their own origin for changes (so an editor ignores its
// own echo and takes the other laptop's changes).
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { AiPanel } from './AiPanel'
import { Browser, type BrowserState } from './Browser'
import { downloadZip } from './download'
import { type Cursor, Editor, type EditorHandle } from './Editor'
import { Explorer, type ExplorerHandle } from './Explorer'
import { Ellipsis, FileIcon, Icon, type IconName, languageName, VSCodeMark } from './icons'
import { type Line, Panel, type PanelTab } from './Panel'
import { build, type Built, previewMessage } from './runner'
import { DebugView, ExtensionsView, ScmView, SearchView } from './Views'
import { ContextMenu, Dialog, type MenuItem, type MenuState, type Question } from './widgets'
import { FOLDER, workspace } from './workspace'
import './vscode.css'

export type VSCodeAppProps = {
  laptop: 'mhmd' | 'zuhair'; user: string
  onClose?: () => void // the window's close button: back to walking, as Esc (LaptopDesk.tsx)
}
type SideView = 'explorer' | 'search' | 'scm' | 'debug' | 'extensions'
const VIEWS: [SideView, IconName, string][] = [
  ['explorer', 'files', 'Explorer (Ctrl+Shift+E)'], ['search', 'search', 'Search (Ctrl+Shift+F)'], ['scm', 'scm', 'Source Control (Ctrl+Shift+G)'],
  ['debug', 'debug', 'Run and Debug (Ctrl+Shift+D)'], ['extensions', 'extensions', 'Extensions (Ctrl+Shift+X)'],
]
const FIRST_OPEN: Record<VSCodeAppProps['laptop'], string> = { mhmd: 'index.html', zuhair: 'app.js' } // the tab open at the start
const MAX_LINES = 500 // kept in the terminal
const SAVED_FOR = 1500 // ms, "Saved" in the status bar after Ctrl+S
const SERVER_LINES: Line[] = [
  { kind: 'out', text: '' },
  { kind: 'ok', text: `  VITE v7.1.3  ready in 212 ms` },
  { kind: 'out', text: '' },
  { kind: 'ok', text: '  ➜  Local:   http://localhost:3000/' },
  { kind: 'out', text: '  ➜  Network: use --host to expose' },
  { kind: 'out', text: '' },
]

export function VSCodeApp({ laptop, user, onClose }: VSCodeAppProps) {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const origin = `vscode:${laptop}`
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorHandle>(null)
  const explorer = useRef<ExplorerHandle>(null)
  const [open, setOpen] = useState<{ tabs: string[]; active: string | null }>(() => {
    const first = workspace.has(FIRST_OPEN[laptop]) ? FIRST_OPEN[laptop] : null
    return { tabs: first ? [first] : [], active: first }
  })
  const [side, setSide] = useState<SideView | null>('explorer')
  const [aiOpen, setAiOpen] = useState(true)
  const [chat, setChat] = useState(0) // New Chat in the side bar's title row mounts a fresh panel
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('terminal')
  const [lines, setLines] = useState<Line[]>([])
  const [run, setRun] = useState<{ built: Built; seq: number } | null>(null)
  const [browser, setBrowser] = useState<BrowserState>('closed')
  const [pageTitle, setPageTitle] = useState('') // the page in the browser, for the chip when it is minimised
  const [cursor, setCursor] = useState<Cursor>({ line: 1, col: 1 })
  const [saved, setSaved] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const { tabs, active } = open

  // the tabs follow the store: a file deleted (anywhere) closes its tab, a renamed one keeps it
  useEffect(() => workspace.subscribe((c) => {
    if (c.type === 'remove') setOpen((o) => closed(o, c.path))
    else if (c.type === 'rename' && c.to) { const to = c.to; setOpen((o) => ({ tabs: o.tabs.map((p) => (p === c.path ? to : p)), active: o.active === c.path ? to : o.active })) }
    else if (c.type === 'reset') setOpen((o) => { const tabs = o.tabs.filter((p) => workspace.has(p)); return { tabs, active: o.active && tabs.includes(o.active) ? o.active : tabs[0] ?? null } })
  }), [])
  const openFile = useCallback((path: string, focus = true) => {
    if (!workspace.has(path)) return
    setOpen((o) => ({ tabs: o.tabs.includes(path) ? o.tabs : [...o.tabs, path], active: path }))
    if (focus) requestAnimationFrame(() => editor.current?.focus())
  }, [])
  const closeTab = (path: string) => setOpen((o) => closed(o, path))
  useEffect(() => { // the active tab stays in view when the strip overflows (VS Code scrolls it)
    const list = root.current?.querySelector<HTMLElement>('.vsc-tab-list'), t = list?.querySelector<HTMLElement>('.vsc-tab.on')
    if (!list || !t) return
    if (t.offsetLeft < list.scrollLeft) list.scrollLeft = t.offsetLeft
    else if (t.offsetLeft + t.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = t.offsetLeft + t.offsetWidth - list.clientWidth
  }, [active, tabs])

  // the console of the page in the browser, into the terminal (blob URLs in it named by their files)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = previewMessage(e.data, laptop)
      if (!m) return
      let text = m.text
      if (run) for (const [url, path] of run.built.names) text = text.split(url).join(path)
      setLines((l) => [...l.slice(-MAX_LINES), { kind: m.type, text }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [laptop, run])
  useEffect(() => () => { run?.built.revoke() }, [run])

  const doRun = useCallback(() => {
    const built = build(laptop)
    setRun((r) => ({ built, seq: (r?.seq ?? 0) + 1 }))
    setBrowser('open'); setPanelOpen(true); setPanelTab('terminal')
    setLines((l) => [...l.slice(-MAX_LINES), { kind: 'cmd', text: 'npm run dev' }, ...SERVER_LINES])
  }, [laptop])

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return // never kept from the office: Esc flies you back to walking
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); setSaved(true); window.setTimeout(() => setSaved(false), SAVED_FOR) } // the store has it already
    else if (ctrl && (e.key === '`' || e.key.toLowerCase() === 'j')) { e.preventDefault(); setPanelOpen((p) => !p) }
    else if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); setSide((s) => (s ? null : 'explorer')) }
    else if (e.key === 'F5') { e.preventDefault(); doRun() }
  }
  // a right-click menu at the mouse, in the page's own pixels (the page may be scaled on the screen)
  const showMenu = (e: MouseEvent, items: MenuItem[]) => {
    const r = root.current!, b = r.getBoundingClientRect()
    const x = ((e.clientX - b.left) * r.offsetWidth) / b.width, y = ((e.clientY - b.top) * r.offsetHeight) / b.height
    setMenu({ x: Math.min(x, r.offsetWidth - 190), y: Math.min(y, r.offsetHeight - items.length * 26 - 30), items })
  }
  const closeMenu = useCallback(() => setMenu(null), [])

  const crumbs = active ? [FOLDER, ...active.split('/')] : []
  const title = `${active ? `${active.split('/').pop()} - ` : ''}${FOLDER} - Visual Studio Code`
  const prompt = `${laptop}@office:~/${FOLDER}`
  return (
    <div className="vsc" ref={root} onKeyDown={keys} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest('.cm-editor, input, .vsc-terminal')) e.preventDefault() }}>
      <header className="vsc-title">
        <span className="vsc-title-mark"><VSCodeMark size={16} /></span>
        <nav className="vsc-menubar">
          {['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'].map((m) => (
            <button key={m} onClick={m === 'Run' ? doRun : m === 'Terminal' ? () => { setPanelOpen(true); setPanelTab('terminal') } : m === 'View' ? () => setSide((s) => s ?? 'explorer') : undefined}>{m}</button>
          ))}
        </nav>
        <div className="vsc-command" title={title}><Icon name="search" size={13} /><span>{title}</span></div>
        <div className="vsc-title-right">
          <div className="vsc-layout-buttons">
            <button className={`vsc-icon-btn${side ? ' on' : ''}`} title="Toggle Primary Side Bar (Ctrl+B)" onClick={() => setSide((s) => (s ? null : 'explorer'))}><Icon name="layout-left" /></button>
            <button className={`vsc-icon-btn${panelOpen ? ' on' : ''}`} title="Toggle Panel (Ctrl+J)" onClick={() => setPanelOpen((p) => !p)}><Icon name="layout-panel" /></button>
            <button className={`vsc-icon-btn${aiOpen ? ' on' : ''}`} title="Toggle Secondary Side Bar (Ctrl+Alt+B)" onClick={() => setAiOpen((a) => !a)}><Icon name="layout-right" /></button>
            <button className="vsc-icon-btn" title="Customize Layout..."><Icon name="layout" /></button>
          </div>
          <button className={`vsc-chat-btn${aiOpen ? ' on' : ''}`} title="Toggle Chat (Ctrl+Alt+I)" onClick={() => setAiOpen((a) => !a)}><Icon name="sparkle" size={14} /><Icon name="chevron-down" size={12} /></button>
          <div className="vsc-window-controls">
            <button title="Minimize"><Icon name="minimize" size={14} /></button>
            <button title="Maximize"><Icon name="maximize" size={12} /></button>
            <button className="close" title="Back to walking (Esc)" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
        </div>
      </header>

      <div className="vsc-body">
        <nav className="vsc-activity">
          {VIEWS.map(([id, icon, name]) => (
            <button key={id} className={`vsc-activity-item${side === id ? ' on' : ''}`} title={name} aria-label={name} onClick={() => setSide((s) => (s === id ? null : id))}>
              <Icon name={icon} size={24} />
            </button>
          ))}
          <span className="vsc-spacer" />
          <button className="vsc-activity-item" title={`Accounts (${user})`} aria-label={`Accounts: ${user}`}><Icon name="account" size={24} /></button>
          <button className="vsc-activity-item" title="Manage" aria-label="Manage"><Icon name="gear" size={24} /></button>
        </nav>

        {side && (
          <aside className="vsc-sidebar">
            {side === 'explorer' && <Explorer ref={explorer} origin={origin} active={active} onOpen={openFile} onDownload={downloadZip} ask={setQuestion} menu={showMenu} />}
            {side === 'search' && <SearchView onOpen={openFile} />}
            {side === 'scm' && <ScmView />}
            {side === 'debug' && <DebugView onRun={doRun} />}
            {side === 'extensions' && <ExtensionsView />}
          </aside>
        )}

        <main className="vsc-main">
          <div className="vsc-editor-group">
            <div className="vsc-tabs">
              <div className="vsc-tab-list">
                {tabs.map((path) => (
                  <div key={path} className={`vsc-tab${path === active ? ' on' : ''}`} title={`~/${FOLDER}/${path}`} onClick={() => openFile(path)} onAuxClick={(e) => { if (e.button === 1) closeTab(path) }}>
                    <FileIcon path={path} /><span>{path.split('/').pop()}</span>
                    <button className="x" title="Close (Ctrl+W)" onClick={(e) => { e.stopPropagation(); closeTab(path) }}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="vsc-editor-actions">
                <button className="vsc-run" title="Run (F5)" onClick={doRun}><Icon name="debug-start" color="#89d185" /><Icon name="chevron-down" size={12} /></button>
                <button className="vsc-download-item" title={`Download Folder (${FOLDER}.zip)`} onClick={downloadZip}><Icon name="cloud-download" /><span>Download</span></button>
                <button title="Split Editor Right"><Icon name="split" /></button>
                <button title="More Actions..."><Ellipsis /></button>
              </div>
            </div>
            {active ? (
              <>
                <div className="vsc-breadcrumbs">
                  {crumbs.map((c, i) => (
                    <span key={i}>{i > 0 && <Icon name="chevron-right" size={14} className="sep" />}{i === crumbs.length - 1 && <FileIcon path={active} size={14} />}{c}</span>
                  ))}
                </div>
                <Editor key={active} ref={editor} path={active} origin={origin} onCursor={setCursor} />
              </>
            ) : (
              <div className="vsc-welcome">
                <VSCodeMark size={240} color="rgba(255, 255, 255, 0.055)" />
                <dl className="vsc-watermark">
                  <dt>Show All Commands</dt><dd><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd></dd>
                  <dt>Go to File</dt><dd><kbd>Ctrl</kbd> + <kbd>P</kbd></dd>
                  <dt>Find in Files</dt><dd><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></dd>
                  <dt>Toggle Terminal</dt><dd><kbd>Ctrl</kbd> + <kbd>`</kbd></dd>
                </dl>
              </div>
            )}
          </div>
          {panelOpen && <Panel tab={panelTab} lines={lines} prompt={prompt} onTab={setPanelTab} onClose={() => setPanelOpen(false)} onClear={() => setLines([])} />}
          {run && browser === 'min' && (
            <button className="vsc-br-chip" title="Show the browser" onClick={() => setBrowser('open')}><Icon name="globe" />{pageTitle || run.built.title}</button>
          )}
        </main>

        {aiOpen && (
          <aside className="vsc-aux">
            <div className="vsc-view-title">
              <span>Chat</span>
              <span className="vsc-actions">
                <button title="New Chat" onClick={() => setChat((c) => c + 1)}><Icon name="add" /></button>
                <button title="Hide Secondary Side Bar" onClick={() => setAiOpen(false)}><Icon name="close" /></button>
              </span>
            </div>
            <div className="vsc-aux-body"><AiPanel key={chat} laptop={laptop} user={user} onOpenFile={openFile} /></div>
          </aside>
        )}
      </div>

      <footer className="vsc-status">
        <div className="vsc-status-left">
          <button className="vsc-status-item remote" title="Open a Remote Window"><Icon name="remote" /></button>
          <button className="vsc-status-item" title="Checkout Branch"><Icon name="scm" />main</button>
          <button className="vsc-status-item" title="Synchronize Changes"><Icon name="sync" /></button>
          <button className="vsc-status-item" title="No Problems" onClick={() => { setPanelOpen(true); setPanelTab('problems') }}><Icon name="error" />0<Icon name="warning" />0</button>
          {saved && <span className="vsc-status-item saved"><Icon name="check" />Saved</span>}
        </div>
        <div className="vsc-status-right">
          {active && <button className="vsc-status-item" title="Go to Line/Column">Ln {cursor.line}, Col {cursor.col}</button>}
          {active && <button className="vsc-status-item" title="Select Indentation">Spaces: 2</button>}
          {active && <button className="vsc-status-item" title="Select Encoding">UTF-8</button>}
          {active && <button className="vsc-status-item" title="Select End of Line Sequence">LF</button>}
          {active && <button className="vsc-status-item" title="Select Language Mode">{languageName(active)}</button>}
          <button className="vsc-status-item" title={browser === 'open' ? 'Close the browser' : 'Run the app in the browser'} onClick={browser === 'open' ? () => setBrowser('closed') : doRun}>
            <Icon name="broadcast" />{browser === 'open' ? 'Port : 3000' : 'Go Live'}
          </button>
          <button className="vsc-status-item" title="No Notifications"><Icon name="bell" /></button>
        </div>
      </footer>

      {run && browser === 'open' && <Browser id={laptop} built={run.built} seq={run.seq} onState={setBrowser} onReload={doRun} onTitle={setPageTitle} />}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {question && <Dialog q={question} onClose={() => setQuestion(null)} />}
    </div>
  )
}

/** The tabs without `path`; the active one moves to its right neighbour, else its left. */
function closed(o: { tabs: string[]; active: string | null }, path: string) {
  const i = o.tabs.indexOf(path)
  if (i < 0) return o
  const tabs = o.tabs.filter((p) => p !== path)
  return { tabs, active: o.active === path ? tabs[Math.min(i, tabs.length - 1)] ?? null : o.active }
}

// Flat, for checks (tools/vscode_check.mjs): ?vscode=1 (or =zuhair) mounts VS Code over the whole window at the
// laptop screen's 1366 x 768, scaled to fit the window as the 3D transform scales it on the screen (&scale=0.6 forces
// one), with no office in the way. main.tsx imports this module when the switch is there.
const params = new URLSearchParams(window.location.search)
const flat = params.get('vscode')
if (flat !== null) {
  const W = 1366, H = 768
  const box = document.createElement('div')
  box.id = 'vsc-flat' // (the check's selectors start here: the laptops' own pages are in the document too)
  Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '100', background: '#000' })
  const page = document.createElement('div')
  Object.assign(page.style, { position: 'absolute', left: '50%', top: '50%', width: `${W}px`, height: `${H}px`, background: '#1f1f1f' })
  const fit = () => { const s = Number(params.get('scale')) || Math.min(window.innerWidth / W, window.innerHeight / H); page.style.transform = `translate(-50%, -50%) scale(${s})` }
  fit(); window.addEventListener('resize', fit)
  box.appendChild(page); document.body.appendChild(box)
  const laptop = flat === 'zuhair' ? 'zuhair' : 'mhmd'
  createRoot(page).render(<VSCodeApp laptop={laptop} user={laptop === 'zuhair' ? 'Zuhair' : 'Mhmd'} />)
}
