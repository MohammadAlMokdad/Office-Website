// The panel under the editor: PROBLEMS (nothing, the workspace is not linted), OUTPUT, DEBUG CONSOLE, TERMINAL (a prompt
// and the run log: the dev server's lines, then what the page in the browser writes to its console) and PORTS.
import { useEffect, useRef } from 'react'
import { Icon } from './icons'

export type Line = { kind: 'cmd' | 'out' | 'ok' | 'log' | 'info' | 'warn' | 'error' | 'debug'; text: string }
export type PanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'
const TABS: [PanelTab, string][] = [['problems', 'Problems'], ['output', 'Output'], ['debug', 'Debug Console'], ['terminal', 'Terminal'], ['ports', 'Ports']]
type Props = { tab: PanelTab; lines: Line[]; prompt: string; onTab: (t: PanelTab) => void; onClose: () => void; onClear: () => void }

export function Panel({ tab, lines, prompt, onTab, onClose, onClear }: Props) {
  const term = useRef<HTMLDivElement>(null)
  useEffect(() => { term.current?.scrollTo({ top: term.current.scrollHeight }) }, [lines, tab])
  return (
    <section className="vsc-panel">
      <div className="vsc-panel-head">
        <div className="vsc-panel-tabs">
          {TABS.map(([id, name]) => (
            <button key={id} className={`vsc-panel-tab${tab === id ? ' on' : ''}`} onClick={() => onTab(id)}>
              {name}{id === 'problems' && <span className="badge">0</span>}
            </button>
          ))}
        </div>
        <div className="vsc-panel-actions">
          {tab === 'terminal' && (
            <>
              <button title="New Terminal"><Icon name="add" /></button>
              <button title="Split Terminal"><Icon name="split" /></button>
              <button title="Clear Terminal" onClick={onClear}><Icon name="trash" /></button>
            </>
          )}
          <button title="Maximize Panel Size"><Icon name="chevron-up" /></button>
          <button title="Hide Panel" onClick={onClose}><Icon name="close" /></button>
        </div>
      </div>
      <div className="vsc-panel-body">
        {tab === 'terminal' && (
          <div className="vsc-terminal" ref={term}>
            {lines.map((l, i) => (
              <div key={i} className={`vsc-term-line ${l.kind}`}>
                {l.kind === 'cmd' && <Prompt text={prompt} />}
                {l.kind === 'warn' && '⚠ '}{l.kind === 'error' && '✖ '}
                {l.text}
              </div>
            ))}
            <div className="vsc-term-line cmd"><Prompt text={prompt} /><span className="cursor" /></div>
          </div>
        )}
        {tab === 'problems' && <div className="vsc-panel-text">No problems have been detected in the workspace.</div>}
        {tab === 'output' && <div className="vsc-panel-text" />}
        {tab === 'debug' && <div className="vsc-panel-text" />}
        {tab === 'ports' && <div className="vsc-panel-text">No forwarded ports. Forward a port to access your running services locally.</div>}
      </div>
    </section>
  )
}

/** user@office:~/my-app$ in the shell's colours. */
function Prompt({ text }: { text: string }) {
  const [who, where] = text.split(':')
  return <span className="p"><span className="who">{who}</span>:<span className="where">{where}</span>$ </span>
}
