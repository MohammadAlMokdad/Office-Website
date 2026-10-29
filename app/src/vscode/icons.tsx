// Codicon-like icons (16 x 16, strokes in the current colour) and Seti-like file icons by extension, for VS Code's
// shell on the laptops. Inline SVG: no icon font to load.

const STROKES = {
  files: 'M5.5 1.5h5l3 3v8h-8z M10.5 1.5v3h3 M3.5 4.5v10h7',
  search: 'M6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M9.8 9.8 14 14',
  scm: 'M4.5 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M4.5 14.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M11.5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M4.5 4.5v7 M11.5 6.5c0 3-7 2-7 5',
  debug: 'M6.5 2.5 14 7.5l-7.5 5z M2 10.5h1 M6 10.5h1 M2 13.5h1 M6 13.5h1 M4.5 9.5a1.7 1.7 0 0 0-1.7 1.7v1.3a1.7 1.7 0 0 0 3.4 0v-1.3a1.7 1.7 0 0 0-1.7-1.7z',
  extensions: 'M1.5 6.5h4.5v4.5H1.5z M1.5 11h4.5v4.5H1.5z M6 11h4.5v4.5H6z M9.5 2h4.5v4.5H9.5z',
  account: 'M8 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2.8 13.5c.6-2.6 2.6-4 5.2-4s4.6 1.4 5.2 4 M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14z',
  gear: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4 M8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z',
  'new-file': 'M9 1.5H3.5v13H8 M9 1.5 12.5 5v3 M9 1.5V5h3.5 M12.5 10v5 M10 12.5h5',
  'new-folder': 'M8 13.5H1.5v-10h5L8 5h6.5v3 M12.5 10v5 M10 12.5h5',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 2.5v3.5h-3.5',
  'collapse-all': 'M2.5 5.5h8v8h-8z M5.5 2.5h8v8 M5 9.5h3',
  'cloud-download': 'M4.5 12.5h-1a3 3 0 0 1-.5-5.9A4.5 4.5 0 0 1 11.7 6a3 3 0 0 1 .8 6.5h-1 M8 7.5v7 M5.5 12l2.5 2.5 2.5-2.5',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  'chevron-up': 'M3.5 10 8 5.5l4.5 4.5',
  edit: 'M11.5 2.5l2 2-8 8-3 1 1-3z M10 4l2 2',
  trash: 'M3 4.5h10 M6.5 4.5v-2h3v2 M4.5 4.5l.7 9h5.6l.7-9 M6.8 7v4.5 M9.2 7v4.5',
  close: 'M4 4l8 8 M12 4l-8 8',
  split: 'M2.5 2.5h11v11h-11z M8 2.5v11',
  terminal: 'M2.5 2.5h11v11h-11z M5 6l2.5 2L5 10 M8.5 10.5h3',
  add: 'M8 3v10 M3 8h10',
  check: 'M3 8.5 6.5 12 13 4.5',
  bell: 'M8 2a4 4 0 0 0-4 4v3l-1.5 2.5h11L12 9V6a4 4 0 0 0-4-4z M6.5 13.5a1.5 1.5 0 0 0 3 0',
  error: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z M5.5 5.5l5 5 M10.5 5.5l-5 5',
  warning: 'M8 2 1.5 13.5h13z M8 6.5v3.5 M8 11.5v.5',
  info: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z M8 7v4.5 M8 4.5v.5',
  sync: 'M13.5 8a5.5 5.5 0 0 1-9.3 4 M2.5 8a5.5 5.5 0 0 1 9.3-4 M2.5 11.5v-3h3 M13.5 4.5v3h-3',
  broadcast: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M5.2 10.8a4 4 0 0 1 0-5.6 M10.8 5.2a4 4 0 0 1 0 5.6 M3.1 12.9a7 7 0 0 1 0-9.8 M12.9 3.1a7 7 0 0 1 0 9.8',
  sparkle: 'M8 1.5c.6 3.5 2 5 6.5 6.5-4.5 1.5-5.9 3-6.5 6.5-.6-3.5-2-5-6.5-6.5 4.5-1.5 5.9-3 6.5-6.5z',
  'layout-left': 'M1.5 2.5h13v11h-13z M5.5 2.5v11',
  'layout-panel': 'M1.5 2.5h13v11h-13z M1.5 9.5h13',
  'layout-right': 'M1.5 2.5h13v11h-13z M10.5 2.5v11',
  layout: 'M1.5 2.5h13v11h-13z M5.5 2.5v11 M10.5 2.5v11 M5.5 9.5h5',
  minimize: 'M3 8h10',
  maximize: 'M3 3h10v10H3z',
  restore: 'M3 5.5h7.5V13H3z M5.5 5.5V3H13v7.5h-2.5',
  'arrow-left': 'M14 8H2 M7 3 2 8l5 5',
  'arrow-right': 'M2 8h12 M9 3l5 5-5 5',
  tune: 'M3 5h10 M3 11h10 M6 3.5v3 M10 9.5v3',
  star: 'M8 2l1.8 3.8 4.2.6-3 2.9.7 4.2L8 11.5l-3.7 2 .7-4.2-3-2.9 4.2-.6z',
  globe: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z M1.5 8h13 M8 1.5c-2 2-2 11 0 13 M8 1.5c2 2 2 11 0 13',
  'list-selection': 'M2.5 4h11 M2.5 8h11 M2.5 12h7',
  'case': 'M2 12 5 4l3 8 M3 9.5h4 M10 7.5a2 2 0 1 1 4 0v4.5 M14 9.5c-2 0-4 .3-4 1.8 0 1.5 3.2 1.5 4-.3',
  'whole-word': 'M1.5 13.5h13 M3 11 5.5 3 8 11 M3.8 8.5h3.4 M9.5 3v8 M9.5 8a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  regex: 'M10.5 2v7 M7.5 3.5l6 4 M13.5 3.5l-6 4 M3.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  replace: 'M2.5 2.5h5v5h-5z M8.5 8.5h5v5h-5z M8.5 4H12l-1.5-1.5 M12 4l-1.5 1.5 M7.5 12H4l1.5 1.5 M4 12l1.5-1.5',
  book: 'M8 3.5c-1.5-1.5-4-1.5-6-.5v10c2-1 4.5-1 6 .5 1.5-1.5 4-1.5 6-.5v-10c-2-1-4.5-1-6 .5z M8 3.5v10',
  'circle-filled': 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'circle-outline': 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z',
  'debug-start': 'M4.5 2.5v11l9-5.5z',
  remote: 'M6.5 3 3 6.5 6.5 10 M9.5 6 13 9.5 9.5 13',
  menu: 'M2.5 4h11 M2.5 8h11 M2.5 12h11',
  lightbulb: 'M8 2a4 4 0 0 0-2.3 7.3c.5.4.8.9.8 1.7h3c0-.8.3-1.3.8-1.7A4 4 0 0 0 8 2z M6.5 13h3 M7 14.5h2',
  copy: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
  'open-preview': 'M2.5 2.5h11v11h-11z M2.5 5.5h11 M7 5.5v8',
}
const FILLED = new Set(['sparkle', 'debug-start', 'circle-filled'])
export type IconName = keyof typeof STROKES

export function Icon({ name, size = 16, className, color }: { name: IconName; size?: number; className?: string; color?: string }) {
  const filled = FILLED.has(name)
  return (
    <svg
      className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
      fill={filled ? color ?? 'currentColor' : 'none'} stroke={filled ? 'none' : color ?? 'currentColor'}
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d={STROKES[name]} />
    </svg>
  )
}

/** Three dots. */
export function Ellipsis({ size = 16, vertical = false }: { size?: number; vertical?: boolean }) {
  const dots = [3.5, 8, 12.5]
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {dots.map((p) => <circle key={p} cx={vertical ? 8 : p} cy={vertical ? p : 8} r="1.2" />)}
    </svg>
  )
}

/** VS Code's own mark (the blue ribbon), for the title bar and the empty editor's watermark. */
export function VSCodeMark({ size = 16, color = '#23a9f2' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path fill={color} d="M74.9 100c-1.4 0-2.7-.5-3.7-1.5l-.1-.1L28.9 59.5l-17 12.9c-1.7 1.3-4.1 1.2-5.7-.3l-5.5-5c-1.9-1.7-1.9-4.7 0-6.4L15.5 50 .7 36.3c-1.9-1.7-1.9-4.7 0-6.4l5.5-5c1.6-1.4 4-1.5 5.7-.3l17 12.9L71.1 1.7C72.9 0 75.6-.4 77.8.7l20.7 10c2.1 1 3.5 3.2 3.5 5.5v67.6c0 2.4-1.4 4.5-3.5 5.5l-20.7 10c-.9.5-1.9.7-2.9.7zM75 27.3 45 50l30 22.7V27.3z" />
    </svg>
  )
}

// Seti-like file icons: a small coloured glyph per kind of file
const SETI = { orange: '#e37933', blue: '#519aba', yellow: '#cbcb41', green: '#8dc149', purple: '#a074c4', grey: '#c5c5c5', pink: '#f55385' }
export const ext = (path: string) => path.split('/').pop()!.split('.').slice(1).pop()?.toLowerCase() ?? ''

export function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  const e = ext(path)
  const s = { width: size, height: size }
  const text = (t: string, color: string, fontSize = 8.5) => (
    <svg {...s} viewBox="0 0 16 16" aria-hidden="true"><text x="8" y="12" textAnchor="middle" fill={color} fontFamily="'Segoe UI', system-ui, sans-serif" fontWeight="700" fontSize={fontSize}>{t}</text></svg>
  )
  const stroke = (d: string, color: string, width = 1.6) => (
    <svg {...s} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  )
  switch (e) {
    case 'html': case 'htm': return stroke('M6 4 2.5 8 6 12 M10 4l3.5 4-3.5 4', SETI.orange)
    case 'css': return stroke('M6 3 4.5 13 M11.5 3 10 13 M3.5 6.5h10 M2.5 10.5h10', SETI.blue, 1.4)
    case 'scss': case 'sass': case 'less': return text(e === 'less' ? 'LESS' : 'SCSS', SETI.pink, 6)
    case 'js': case 'mjs': case 'cjs': return text('JS', SETI.yellow, 9)
    case 'jsx': case 'tsx': return stroke('M8 9.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z M8 11.5c-3.6 0-6.5-1.6-6.5-3.5S4.4 4.5 8 4.5s6.5 1.6 6.5 3.5-2.9 3.5-6.5 3.5z M5 9.8c-1.8-3.1-2-6.4-.3-7.4 1.7-1 4.3.9 6.2 4 1.8 3.1 2 6.4.3 7.4-1.7 1-4.3-.9-6.2-4z M11 9.8c1.8-3.1 2-6.4.3-7.4-1.7-1-4.3.9-6.2 4-1.8 3.1-2 6.4-.3 7.4 1.7 1 4.3-.9 6.2-4z', SETI.blue, 1)
    case 'ts': return text('TS', SETI.blue, 9)
    case 'json': return stroke('M6 2.5c-2 0-2 1-2 2.5s0 2.5-1.5 3c1.5.5 1.5 1.5 1.5 3s0 2.5 2 2.5 M10 2.5c2 0 2 1 2 2.5s0 2.5 1.5 3c-1.5.5-1.5 1.5-1.5 3s0 2.5-2 2.5', SETI.yellow, 1.4)
    case 'md': case 'markdown': return (
      <svg {...s} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 12V4h2l2 3 2-3h2v8H8V7.5L6 10 4 7.5V12z" fill={SETI.blue} />
        <path d="M12.5 4v6 M10.5 8l2 2.5 2-2.5" fill="none" stroke={SETI.blue} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
    case 'py': return (
      <svg {...s} viewBox="0 0 16 16" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 1.5c-2.5 0-3 1-3 2.3V5.5H2.5c-1 0-1.5 1-1.5 2.5s.5 2.5 1.5 2.5H4.5V8.6c0-1 .8-1.6 1.7-1.6h3.6c.8 0 1.2-.5 1.2-1.3V3.8C11 2.5 10.5 1.5 8 1.5z" stroke={SETI.blue} />
        <path d="M8 14.5c2.5 0 3-1 3-2.3V10.5h2.5c1 0 1.5-1 1.5-2.5s-.5-2.5-1.5-2.5H11.5v1.9c0 1-.8 1.6-1.7 1.6H6.2c-.8 0-1.2.5-1.2 1.3v1.9C5 13.5 5.5 14.5 8 14.5z" stroke={SETI.yellow} />
      </svg>
    )
    case 'svg': return stroke('M8 2.5 13.5 8 8 13.5 2.5 8z M8 6v4 M6 8h4', SETI.purple, 1.3)
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'ico': return stroke('M2.5 3.5h11v9h-11z M2.5 10l3-3 3 3 2-2 3 3 M10.5 6.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z', SETI.purple, 1.2)
    case 'yml': case 'yaml': return text('Y', SETI.purple, 10)
    case 'xml': return stroke('M5.5 4 2.5 8l3 4 M10.5 4l3 4-3 4 M9 3 7 13', SETI.orange, 1.4)
    case 'sh': case 'bash': case 'bat': case 'ps1': return stroke('M2.5 3.5h11v9h-11z M5 6l2 2-2 2 M8.5 10h3', SETI.green, 1.3)
    case 'txt': case 'log': return stroke('M4 2.5h5.5l3 3v8H4z M9.5 2.5v3h3 M6 8h4.5 M6 10.5h4.5', SETI.grey, 1.2)
    case 'env': case 'gitignore': case 'editorconfig': return stroke('M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8 2v2 M8 12v2 M2 8h2 M12 8h2', SETI.grey, 1.3)
    case 'lock': return stroke('M4 7.5h8v6H4z M5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2', SETI.yellow, 1.3)
    case 'toml': case 'ini': case 'cfg': return stroke('M3 4h10 M3 8h6 M3 12h8', SETI.grey, 1.4)
    case 'csv': return stroke('M2.5 3.5h11v9h-11z M2.5 7.5h11 M6.5 3.5v9', SETI.green, 1.2)
    default: return stroke('M4 2.5h5.5l3 3v8H4z M9.5 2.5v3h3', SETI.grey, 1.2)
  }
}

/** The language shown in the status bar. */
export function languageName(path: string) {
  const e = ext(path)
  return ({
    html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript JSX',
    ts: 'TypeScript', tsx: 'TypeScript JSX', json: 'JSON', md: 'Markdown', py: 'Python', svg: 'XML', xml: 'XML', yml: 'YAML', yaml: 'YAML',
    txt: 'Plain Text', sh: 'Shell Script', csv: 'CSV',
  } as Record<string, string>)[e] ?? 'Plain Text'
}
