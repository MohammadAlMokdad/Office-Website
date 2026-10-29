// The EXPLORER view: the workspace's files as a tree (folders first, collapsible), VS Code's toolbar (New File, New
// Folder, Refresh, Collapse) and Download, inline inputs for new names (Enter makes the file, with folders in the name
// if typed, Esc cancels), rename and delete on hover or from the right-click menu; delete asks in a dialog of VS Code's
// own (never the browser's).
import { type MouseEvent, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react'
import { FileIcon, Icon } from './icons'
import type { MenuItem, Question } from './widgets'
import { normalizePath, workspace } from './workspace'

type Node = { name: string; path: string; folder: boolean; children: Node[] }
type Row = { node: Node; depth: number }
type Editing = { kind: 'file' | 'folder'; in: string } | { kind: 'rename'; path: string; folder: boolean }
type Props = {
  origin: string // this laptop: its changes are marked with it
  active: string | null // the file in the editor
  onOpen: (path: string) => void
  onDownload: () => void
  ask: (q: Question) => void
  menu: (e: MouseEvent, items: MenuItem[]) => void
}
export type ExplorerHandle = { newFile: () => void; newFolder: () => void }

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const byName = (a: Node, b: Node) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/** The tree of the workspace's paths, plus folders that have no files yet (just made). */
function tree(paths: string[], empty: Iterable<string>): Node[] {
  const root: Node = { name: '', path: '', folder: true, children: [] }
  const dir = (path: string) => {
    let at = root
    if (!path) return at
    for (const name of path.split('/')) {
      let next = at.children.find((c) => c.folder && c.name === name)
      if (!next) { next = { name, path: at.path ? `${at.path}/${name}` : name, folder: true, children: [] }; at.children.push(next) }
      at = next
    }
    return at
  }
  for (const f of empty) dir(f)
  for (const p of paths) dir(folderOf(p)).children.push({ name: baseOf(p), path: p, folder: false, children: [] })
  const sort = (n: Node) => { n.children.sort(byName); n.children.forEach(sort) }
  sort(root)
  return root.children
}

export function Explorer({ origin, active, onOpen, onDownload, ask, menu, ref }: Props & { ref?: Ref<ExplorerHandle> }) {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const paths = workspace.list()
  const [selected, setSelected] = useState<string | null>(active)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [empty, setEmpty] = useState<Set<string>>(() => new Set()) // folders made here that hold no file yet
  const [editing, setEditing] = useState<Editing | null>(null)
  const [rootOpen, setRootOpen] = useState(true)
  const [, refresh] = useState(0)

  // folders that got a file are no longer "empty"; folders of files that went are forgotten
  useEffect(() => {
    if (!empty.size) return
    const gone = [...empty].filter((f) => paths.some((p) => p.startsWith(`${f}/`)))
    if (gone.length) setEmpty((s) => { const n = new Set(s); gone.forEach((g) => n.delete(g)); return n })
  }, [paths, empty])

  const nodes = tree(paths, empty)
  const rows: Row[] = []
  const walk = (list: Node[], depth: number) => {
    for (const n of list) {
      rows.push({ node: n, depth })
      if (n.folder && !collapsed.has(n.path)) walk(n.children, depth + 1)
    }
  }
  if (rootOpen) walk(nodes, 0)

  const isFolder = (path: string) => empty.has(path) || paths.some((p) => p.startsWith(`${path}/`))
  const expand = (path: string) => { if (collapsed.has(path)) setCollapsed((s) => { const n = new Set(s); n.delete(path); return n }) }
  const toggle = (path: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const startNew = (kind: 'file' | 'folder') => {
    const where = selected ? (isFolder(selected) ? selected : folderOf(selected)) : ''
    setRootOpen(true); if (where) expand(where)
    setEditing({ kind, in: where })
  }
  useImperativeHandle(ref, () => ({ newFile: () => startNew('file'), newFolder: () => startNew('folder') }))

  const remove = (path: string, folder: boolean) => ask({
    title: `Are you sure you want to delete '${baseOf(path)}'?`,
    detail: folder ? 'The folder and everything in it will be deleted.' : 'The file will be deleted.',
    ok: 'Delete',
    onOk: () => {
      if (folder) { workspace.removeFolder(path, origin); setEmpty((s) => { const n = new Set(s); n.delete(path); return n }) }
      else workspace.remove(path, origin)
      if (selected === path) setSelected(null)
    },
  })
  const submitNew = (kind: 'file' | 'folder', where: string, name: string): string | null => {
    const path = normalizePath(where ? `${where}/${name}` : name)
    if (!path) return 'A file or folder name must be provided.'
    if (workspace.has(path) || isFolder(path)) return `A file or folder '${baseOf(path)}' already exists at this location.`
    if (kind === 'file') { workspace.create(path, '', origin); setSelected(path); onOpen(path) }
    else { setEmpty((s) => new Set(s).add(path)); setSelected(path) }
    return null
  }
  const submitRename = (path: string, folder: boolean, name: string): string | null => {
    const to = normalizePath(folderOf(path) ? `${folderOf(path)}/${name}` : name)
    if (!to) return 'A file or folder name must be provided.'
    if (to === path) return null
    if (workspace.has(to) || isFolder(to)) return `A file or folder '${baseOf(to)}' already exists at this location.`
    if (folder) {
      for (const p of paths) if (p.startsWith(`${path}/`)) workspace.rename(p, `${to}/${p.slice(path.length + 1)}`, origin)
      setEmpty((s) => { const n = new Set(s); if (n.delete(path)) n.add(to); return n })
    } else workspace.rename(path, to, origin)
    setSelected(to)
    return null
  }

  const rowMenu = (e: MouseEvent, node: Node | null) => {
    e.preventDefault(); e.stopPropagation()
    if (node) setSelected(node.path)
    const items: MenuItem[] = [
      { label: 'New File...', run: () => { if (node) setSelected(node.path); setTimeout(() => startNew('file')) } },
      { label: 'New Folder...', run: () => { if (node) setSelected(node.path); setTimeout(() => startNew('folder')) } },
      { sep: true },
      { label: 'Download Folder', run: onDownload },
    ]
    if (node) items.push({ sep: true }, { label: 'Rename...', run: () => setEditing({ kind: 'rename', path: node.path, folder: node.folder }) }, { label: 'Delete', run: () => remove(node.path, node.folder) })
    menu(e, items)
  }

  const editRow = (depth: number) => editing && editing.kind !== 'rename' && (
    <NameInput key="new" depth={depth} kind={editing.kind} initial="" onDone={(name) => (name === null ? null : submitNew(editing.kind, editing.in, name))} onClose={() => setEditing(null)} />
  )
  const out: ReactNode[] = []
  if (editing && editing.kind !== 'rename' && editing.in === '') out.push(editRow(0))
  for (const { node, depth } of rows) {
    if (editing?.kind === 'rename' && editing.path === node.path) {
      out.push(<NameInput key={`rename:${node.path}`} depth={depth} kind={node.folder ? 'folder' : 'file'} initial={node.name} onDone={(name) => (name === null ? null : submitRename(node.path, node.folder, name))} onClose={() => setEditing(null)} />)
    } else {
      const open = node.folder && !collapsed.has(node.path)
      out.push(
        <div
          key={node.path} title={node.path}
          className={`vsc-row${selected === node.path ? ' sel' : ''}${active === node.path ? ' open' : ''}`}
          style={{ paddingLeft: 8 + depth * 8 }}
          onClick={(e) => { e.stopPropagation(); setSelected(node.path); if (node.folder) toggle(node.path); else onOpen(node.path) }}
          onContextMenu={(e) => rowMenu(e, node)}
        >
          {Array.from({ length: depth }, (_, i) => <i key={i} className="vsc-guide" style={{ left: 16 + i * 8 }} />)}
          <span className="vsc-twistie">{node.folder && <Icon name={open ? 'chevron-down' : 'chevron-right'} />}</span>
          {!node.folder && <span className="vsc-ficon"><FileIcon path={node.path} /></span>}
          <span className="vsc-label">{node.name}</span>
          <span className="vsc-row-actions">
            <button title="Rename" onClick={(e) => { e.stopPropagation(); setEditing({ kind: 'rename', path: node.path, folder: node.folder }) }}><Icon name="edit" /></button>
            <button title="Delete" onClick={(e) => { e.stopPropagation(); remove(node.path, node.folder) }}><Icon name="trash" /></button>
          </span>
        </div>,
      )
    }
    if (editing && editing.kind !== 'rename' && node.folder && editing.in === node.path) out.push(editRow(depth + 1))
  }

  return (
    <div className="vsc-explorer">
      <div className="vsc-view-title">
        <span>Explorer</span>
        <span className="vsc-actions">
          <button title="Download Folder (my-app.zip)" className="vsc-download" onClick={onDownload}><Icon name="cloud-download" /></button>
          <button title="Views and More Actions..."><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" /></svg></button>
        </span>
      </div>
      <div className="vsc-section" onClick={() => setRootOpen(!rootOpen)}>
        <Icon name={rootOpen ? 'chevron-down' : 'chevron-right'} />
        <span className="vsc-section-name">my-app</span>
        <span className="vsc-actions" onClick={(e) => e.stopPropagation()}>
          <button title="New File..." className="vsc-new-file" onClick={() => startNew('file')}><Icon name="new-file" /></button>
          <button title="New Folder..." className="vsc-new-folder" onClick={() => startNew('folder')}><Icon name="new-folder" /></button>
          <button title="Refresh Explorer" onClick={() => refresh((n) => n + 1)}><Icon name="refresh" /></button>
          <button title="Collapse Folders in Explorer" onClick={() => setCollapsed(new Set(paths.map(folderOf).filter(Boolean).flatMap((f) => f.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')))))}><Icon name="collapse-all" /></button>
        </span>
      </div>
      <div className="vsc-tree" onClick={() => setSelected(null)} onContextMenu={(e) => rowMenu(e, null)}>
        {out}
        {!paths.length && !editing && <div className="vsc-tree-empty">No files yet. New File to start.</div>}
      </div>
    </div>
  )
}

/** The inline name box of the tree: Enter accepts (or shows why not), Escape cancels, a click elsewhere accepts too. */
function NameInput({ depth, kind, initial, onDone, onClose }: { depth: number; kind: 'file' | 'folder'; initial: string; onDone: (name: string | null) => string | null; onClose: () => void }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = input.current!
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length) // the name without its extension, as VS Code selects it
  }, [initial])
  const finish = (accept: boolean) => {
    if (done.current) return
    const name = value.trim()
    if (!accept || !name || name === initial) { done.current = true; onClose(); return }
    const problem = onDone(name)
    if (problem) { setError(problem); input.current?.focus(); return }
    done.current = true; onClose()
  }
  return (
    <div className="vsc-row vsc-row-edit" style={{ paddingLeft: 8 + depth * 8 }} onClick={(e) => e.stopPropagation()}>
      <span className="vsc-twistie">{kind === 'folder' && <Icon name="chevron-right" />}</span>
      {kind === 'file' && <span className="vsc-ficon"><FileIcon path={value || 'x'} /></span>}
      <div className="vsc-name-box">
        <input
          ref={input} value={value} spellCheck={false} autoComplete="off" aria-label={kind === 'file' ? 'New file name' : 'New folder name'}
          className={error ? 'bad' : ''}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true) }
            else if (e.key === 'Escape') finish(false) // (not stopped: Esc also flies you back from the screen)
            else e.stopPropagation() // the letters are for the name, not the editor's shortcuts
          }}
          onBlur={() => setTimeout(() => finish(!error), 0)} // a click elsewhere accepts a good name, drops a bad one
        />
        {error && <div className="vsc-name-error">{error}</div>}
      </div>
    </div>
  )
}
