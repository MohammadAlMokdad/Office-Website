// The text editor: CodeMirror 6 with VS Code's dark colours and the language by the file's extension, kept in sync
// with the workspace: what you type is written to the store (debounced), and a change to the open file from elsewhere
// (the other laptop, the AI) replaces just the part that changed, so the cursor keeps its place.
// (CodeMirror, not Monaco: it measures itself through the CSS 3D transform that lays the page on the laptop's screen.)
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars,
  keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view'
import { vscodeDarkInit } from '@uiw/codemirror-theme-vscode'
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import { ext } from './icons'
import { workspace } from './workspace'

export type EditorHandle = { focus: () => void }
export type Cursor = { line: number; col: number }
const SAVE_DELAY = 150 // ms after the last key before the store gets the text
const remote = Annotation.define<boolean>() // a change that came from the store (not to be written back)

function language(path: string): Extension {
  switch (ext(path)) {
    case 'js': case 'mjs': case 'cjs': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'ts': return javascript({ typescript: true })
    case 'tsx': return javascript({ jsx: true, typescript: true })
    case 'html': case 'htm': return html()
    case 'css': return css()
    case 'json': return json()
    case 'py': return python()
    case 'md': case 'markdown': return markdown()
    default: return []
  }
}

const MONO = "Consolas, 'Cascadia Code', 'Courier New', monospace"
const theme = [
  vscodeDarkInit({
    settings: {
      background: '#1f1f1f', foreground: '#cccccc', caret: '#aeafad', selection: '#264f78', selectionMatch: '#add6ff26', lineHighlight: 'transparent',
      gutterBackground: '#1f1f1f', gutterForeground: '#6e7681', gutterActiveForeground: '#cccccc', fontFamily: MONO,
    },
  }),
  EditorView.theme({
    '&': { height: '100%', fontSize: '14px' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '19px', overflow: 'auto' },
    '.cm-content': { padding: '0 0 120px', caretColor: '#aeafad' },
    '.cm-line': { padding: '0 8px 0 4px' },
    '.cm-gutters': { borderRight: 'none', minWidth: '56px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '40px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', color: '#c5c5c5' },
    '.cm-activeLine': { boxShadow: 'inset 0 0 0 1px #282828' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid #888', outlineOffset: '-1px' },
    '.cm-selectionBackground': { backgroundColor: '#264f78 !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#264f78 !important' },
    '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
    '.cm-searchMatch': { backgroundColor: 'rgba(234, 92, 0, 0.33)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#9e6a03' },
    '.cm-cursor': { borderLeftWidth: '2px' },
    '.cm-tooltip': { backgroundColor: '#202020', border: '1px solid #454545', color: '#cccccc', fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: '13px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: MONO, fontSize: '13px', maxHeight: '220px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 6px', lineHeight: '20px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#04395e', color: '#ffffff' },
    '.cm-completionIcon': { opacity: '0.7', width: '18px' },
    '.cm-completionDetail': { color: '#9d9d9d', fontStyle: 'normal' },
    '.cm-panels': { backgroundColor: '#252526', color: '#cccccc', borderBottom: '1px solid #454545', fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: '13px' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #2b2b2b', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.36)' },
    '.cm-panel.cm-search': { padding: '6px 8px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'inherit', fontSize: '13px' },
    '.cm-panel.cm-search input': { backgroundColor: '#313131', border: '1px solid #3c3c3c', color: '#cccccc', borderRadius: '2px', padding: '3px 6px', outline: 'none' },
    '.cm-panel.cm-search input:focus': { borderColor: '#0078d4' },
    '.cm-panel.cm-search button': { backgroundColor: 'transparent', border: '0', color: '#cccccc', textTransform: 'none', backgroundImage: 'none', padding: '3px 6px', cursor: 'pointer' },
    '.cm-panel.cm-search button:hover': { backgroundColor: 'rgba(90, 93, 94, 0.31)', borderRadius: '3px' },
    '.cm-panel.cm-search label': { fontSize: '12px', marginRight: '6px' },
    '.cm-panel.cm-search [name=close]': { color: '#cccccc', fontSize: '18px' },
  }),
]

const setup: Extension = [
  lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
  EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
  rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
  indentUnit.of('  '), EditorState.tabSize.of(2),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
]

type Props = { path: string; origin: string; onCursor: (c: Cursor) => void; ref?: Ref<EditorHandle> }

export function Editor({ path, origin, onCursor, ref }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cursor = useRef(onCursor); cursor.current = onCursor
  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }), [])

  useEffect(() => {
    let timer = 0
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: workspace.read(path) ?? '',
        extensions: [
          setup, language(path), theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(remote))) { clearTimeout(timer); timer = window.setTimeout(flush, SAVE_DELAY) }
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head, line = u.state.doc.lineAt(head)
              cursor.current({ line: line.number, col: head - line.from + 1 })
            }
          }),
        ],
      }),
    })
    view.current = v
    const flush = () => {
      clearTimeout(timer); timer = 0
      if (!workspace.has(path)) return // deleted meanwhile: do not bring it back
      const text = v.state.doc.toString()
      if (text !== workspace.read(path)) workspace.write(path, text, origin)
    }
    const unsubscribe = workspace.subscribe((c) => {
      if (c.path !== path || c.origin === origin || (c.type !== 'write' && c.type !== 'create')) return
      const text = workspace.read(path) ?? '', cur = v.state.doc.toString()
      if (text === cur) return
      if (timer) flush() // what was typed here goes first (last writer wins; the other side gets it the same way)
      if (v.state.doc.toString() === text) return
      let a = 0, b = 0
      while (a < cur.length && a < text.length && cur[a] === text[a]) a++
      while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++
      v.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) }, annotations: remote.of(true) })
    })
    const head = v.state.selection.main.head, line = v.state.doc.lineAt(head)
    cursor.current({ line: line.number, col: head - line.from + 1 })
    return () => { if (timer) flush(); unsubscribe(); v.destroy(); view.current = null }
  }, [path, origin])

  return <div className="vsc-editor" ref={host} />
}
