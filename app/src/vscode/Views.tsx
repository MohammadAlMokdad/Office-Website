// The other views of the primary side bar: SEARCH (every line in the workspace with the text, a click opens the file),
// SOURCE CONTROL, RUN AND DEBUG (its button runs the app) and EXTENSIONS, as VS Code shows them for a plain folder.
import { useState, useSyncExternalStore } from 'react'
import { FileIcon, Icon } from './icons'
import { workspace } from './workspace'

const MAX_HITS = 200

export function SearchView({ onOpen }: { onOpen: (path: string) => void }) {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState(false)
  const q = query.toLowerCase()
  const hits: { path: string; lines: { n: number; text: string; at: number }[] }[] = []
  let count = 0
  if (q) {
    for (const path of workspace.list()) {
      const lines: { n: number; text: string; at: number }[] = []
      workspace.read(path)!.split('\n').forEach((text, i) => {
        const at = text.toLowerCase().indexOf(q)
        if (at >= 0 && count < MAX_HITS) { lines.push({ n: i + 1, text, at }); count++ }
      })
      if (lines.length) hits.push({ path, lines })
    }
  }
  const box = (value: string, set: (v: string) => void, placeholder: string, opts: React.ReactNode) => (
    <div className="vsc-search-box">
      <input value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }} />
      <span className="opts">{opts}</span>
    </div>
  )
  return (
    <div className="vsc-search">
      <div className="vsc-view-title"><span>Search</span><span className="vsc-actions"><button title="Refresh"><Icon name="refresh" /></button><button title="Clear Search Results" onClick={() => setQuery('')}><Icon name="close" /></button><button title="Collapse All"><Icon name="collapse-all" /></button></span></div>
      <div className="vsc-search-row">
        <button className="vsc-search-toggle" title="Toggle Replace" onClick={() => setReplace(!replace)}><Icon name={replace ? 'chevron-down' : 'chevron-right'} /></button>
        <div className="vsc-search-boxes">
          {box(query, setQuery, 'Search', <><button title="Match Case"><Icon name="case" size={14} /></button><button title="Match Whole Word"><Icon name="whole-word" size={14} /></button><button title="Use Regular Expression"><Icon name="regex" size={14} /></button></>)}
          {replace && box('', () => {}, 'Replace', <button title="Replace All"><Icon name="replace" size={14} /></button>)}
        </div>
      </div>
      <div className="vsc-search-results">
        {q && !hits.length && <div className="vsc-search-msg">No results found. Review your settings for configured exclusions and check your gitignore files</div>}
        {q && hits.length > 0 && <div className="vsc-search-msg">{count} result{count === 1 ? '' : 's'} in {hits.length} file{hits.length === 1 ? '' : 's'}</div>}
        {hits.map((h) => (
          <div key={h.path}>
            <div className="vsc-search-file" onClick={() => onOpen(h.path)}>
              <Icon name="chevron-down" /><FileIcon path={h.path} /><span className="name">{h.path.split('/').pop()}</span>
              <span className="dim">{h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : ''}</span>
              <span className="badge">{h.lines.length}</span>
            </div>
            {h.lines.map((l) => (
              <div key={l.n} className="vsc-search-line" title={`line ${l.n}`} onClick={() => onOpen(h.path)}>
                {l.text.slice(Math.max(0, l.at - 20), l.at)}<mark>{l.text.slice(l.at, l.at + query.length)}</mark>{l.text.slice(l.at + query.length)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ScmView() {
  return (
    <div className="vsc-view">
      <div className="vsc-view-title"><span>Source Control</span></div>
      <div className="vsc-view-body">
        <p>The folder currently open doesn't have a Git repository. You can initialize a repository which will enable source control features powered by Git.</p>
        <button className="vsc-button">Initialize Repository</button>
        <p>You can directly publish this folder to a GitHub repository. Once published, you'll have access to source control features powered by Git and GitHub.</p>
        <button className="vsc-button">Publish to GitHub</button>
      </div>
    </div>
  )
}

export function DebugView({ onRun }: { onRun: () => void }) {
  return (
    <div className="vsc-view">
      <div className="vsc-view-title"><span>Run and Debug</span></div>
      <div className="vsc-view-body">
        <button className="vsc-button" onClick={onRun}>Run and Debug</button>
        <p>To customize Run and Debug, <a>create a launch.json file</a>.</p>
        <p><a>Show all automatic debug configurations</a>.</p>
      </div>
    </div>
  )
}

const EXTENSIONS = [
  { name: 'Python', by: 'ms-python', about: 'Python language support with extension access points for IntelliSense (Pylance), Debugging (Python Debugger), linting, formatting, refactoring, unit tests, and more.', bg: '#3572a5', mark: 'Py' },
  { name: 'Prettier - Code formatter', by: 'Prettier', about: 'Code formatter using prettier', bg: '#56b3b4', mark: 'P' },
  { name: 'ESLint', by: 'Microsoft', about: 'Integrates ESLint JavaScript into VS Code.', bg: '#4b32c3', mark: 'ES' },
  { name: 'Live Server', by: 'Ritwick Dey', about: 'Launch a development local Server with live reload feature for static & dynamic pages', bg: '#7b2cbf', mark: 'LS' },
  { name: 'GitLens — Git supercharged', by: 'GitKraken', about: 'Supercharge Git within VS Code — Visualize code authorship at a glance via Git blame annotations and CodeLens…', bg: '#8b1e3f', mark: 'GL' },
]
export function ExtensionsView() {
  const [query, setQuery] = useState('')
  const list = EXTENSIONS.filter((x) => x.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="vsc-view vsc-ext">
      <div className="vsc-view-title"><span>Extensions</span><span className="vsc-actions"><button title="Filter Extensions..."><Icon name="list-selection" /></button><button title="Refresh"><Icon name="refresh" /></button></span></div>
      <div className="vsc-search-box" style={{ margin: '0 12px 8px 20px' }}>
        <input value={query} placeholder="Search Extensions in Marketplace" spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }} />
      </div>
      <div className="vsc-section"><Icon name="chevron-down" /><span className="vsc-section-name">{query ? 'Marketplace' : 'Popular'}</span></div>
      <div className="vsc-ext-list">
        {list.map((x) => (
          <div key={x.name} className="vsc-ext-item">
            <div className="vsc-ext-icon" style={{ background: x.bg }}>{x.mark}</div>
            <div className="vsc-ext-text">
              <div className="vsc-ext-name">{x.name}</div>
              <div className="vsc-ext-desc">{x.about}</div>
              <div className="vsc-ext-foot"><span className="vsc-ext-pub">{x.by}</span><button className="vsc-ext-install">Install</button></div>
            </div>
          </div>
        ))}
        {!list.length && <div className="vsc-search-msg">No extensions found.</div>}
      </div>
    </div>
  )
}
