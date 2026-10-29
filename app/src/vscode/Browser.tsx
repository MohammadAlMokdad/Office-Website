// The browser window on the laptop's screen, over VS Code: a Chrome-like window (tab with the page's title, back /
// forward / reload, the address bar reading http://localhost:3000/, minimise and close) around an <iframe> that shows
// the page the runner built (runner.ts) from the workspace. Minimised or closed, VSCodeApp shows a chip / the status
// bar item that brings it back; the page is built again (fresh files) when it opens again.
import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { type Built, PREVIEW_URL } from './runner'

export type BrowserState = 'closed' | 'open' | 'min'
type Props = { id: string; built: Built; seq: number; onState: (s: BrowserState) => void; onReload: () => void; onTitle: (t: string) => void }

export function Browser({ id, built, seq, onState, onReload, onTitle }: Props) {
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState(built.title)
  useEffect(() => { setLoading(true); setTitle(built.title); onTitle(built.title) }, [seq, built, onTitle])
  return (
    <div className="vsc-browser" role="dialog" aria-label="Browser">
      <div className="vsc-br-tabs">
        <div className="vsc-br-tab" title={title}>
          <Icon name="globe" size={14} /><span>{title}</span>
          <button className="x" title="Close tab" onClick={() => onState('closed')}><Icon name="close" size={12} /></button>
        </div>
        <button className="vsc-br-new" title="New tab"><Icon name="add" size={14} /></button>
        <span className="vsc-br-spacer" />
        <div className="vsc-br-controls">
          <button title="Minimize" onClick={() => onState('min')}><Icon name="minimize" size={14} /></button>
          <button title="Maximize"><Icon name="maximize" size={12} /></button>
          <button className="close" title="Close" onClick={() => onState('closed')}><Icon name="close" size={14} /></button>
        </div>
      </div>
      <div className="vsc-br-bar">
        <button title="Back" disabled><Icon name="arrow-left" /></button>
        <button title="Forward" disabled><Icon name="arrow-right" /></button>
        <button title="Reload" onClick={onReload}><Icon name="refresh" /></button>
        <div className="vsc-br-url"><Icon name="tune" size={14} /><span>{PREVIEW_URL}</span></div>
        <button title="Bookmark this tab"><Icon name="star" /></button>
        <button title="Chrome"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="8" cy="12.5" r="1.3" /></svg></button>
      </div>
      <div className="vsc-br-page">
        <iframe
          key={seq} name={`preview-${id}`} title="Preview" srcDoc={built.html}
          sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
          onLoad={(e) => { setLoading(false); const t = e.currentTarget.contentDocument?.title; if (t) { setTitle(t); onTitle(t) } }}
        />
        {loading && <div className="vsc-br-loading"><div className="vsc-br-spinner" />Loading…</div>}
      </div>
    </div>
  )
}
