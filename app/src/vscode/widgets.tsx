// Small pieces of VS Code's chrome: the right-click menu and the dialog that asks before deleting, in VS Code's own
// look (the browser's prompts and confirms are never used: they would not work from the page on the laptop's screen).
import { useEffect, useRef } from 'react'
import { Icon } from './icons'

export type MenuItem = { label: string; run: () => void; sep?: false } | { sep: true }
export type MenuState = { x: number; y: number; items: MenuItem[] } // x, y: in the page's own pixels (not the window's)
export type Question = { title: string; detail?: string; ok: string; onOk: () => void }

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!el.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() } // (not stopped: Esc also leaves the screen)
    window.addEventListener('mousedown', away, true); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  return (
    <div ref={el} className="vsc-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => it.sep
        ? <div key={i} className="vsc-menu-sep" />
        : <button key={i} onClick={() => { onClose(); it.run() }}>{it.label}</button>)}
    </div>
  )
}

export function Dialog({ q, onClose }: { q: Question; onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => { ok.current?.focus() }, [])
  const accept = () => { onClose(); q.onOk() }
  return (
    <div className="vsc-dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="vsc-dialog" role="dialog" aria-label={q.title}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'Enter') { e.preventDefault(); accept() } }}
      >
        <div className="vsc-dialog-icon"><Icon name="warning" size={28} color="#cca700" /></div>
        <div className="vsc-dialog-text"><b>{q.title}</b>{q.detail && <p>{q.detail}</p>}</div>
        <div className="vsc-dialog-buttons">
          <button ref={ok} className="vsc-button" onClick={accept}>{q.ok}</button>
          <button className="vsc-button secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
