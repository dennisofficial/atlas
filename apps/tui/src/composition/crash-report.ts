export type CrashFrame = {
  file: string
  line: number
  column: number
}

const V8_FRAME = /^\s*at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?\s*$/

const JSC_FRAME = /^\s*(?:.*?@)?(\/.+?):(\d+):(\d+)\s*$/

const CONTEXT_LINES = 3

const MAX_ANNOTATED_FRAMES = 2

const FOCUS_MARKER = '›'

const GUTTER_SEPARATOR = ' │ '

const INDENT = '    '

const BUNDLED_PREFIX = '/$bunfs/'

export function parseCrashFrame(text: string): CrashFrame | null {
  const matched = V8_FRAME.exec(text) ?? JSC_FRAME.exec(text)
  if (matched === null) return null

  const [, file, line, column] = matched
  if (file === undefined || line === undefined || column === undefined) return null
  if (!file.startsWith('/')) return null

  return { file, line: Number(line), column: Number(column) }
}

export function isOwnFrame(frame: CrashFrame): boolean {
  if (frame.file.startsWith(BUNDLED_PREFIX)) return false
  if (frame.file.includes('/node_modules/')) return false
  return /\.(tsx?|jsx?|mts|cts)$/.test(frame.file)
}

const clipped = (args: { text: string; cells: number }): string =>
  args.text.length <= args.cells ? args.text : `${args.text.slice(0, args.cells - 1)}…`

export function codeFrame(args: {
  source: string
  line: number
  column: number
  cells: number
}): string[] {
  const lines = args.source.split('\n')
  const first = Math.max(1, args.line - CONTEXT_LINES)
  const last = Math.min(lines.length, args.line + CONTEXT_LINES)
  if (args.line < 1 || args.line > lines.length) return []

  const gutter = String(last).length
  const rendered: string[] = []

  for (let at = first; at <= last; at += 1) {
    const focused = at === args.line
    const number = String(at).padStart(gutter, ' ')
    const head = `${INDENT}${focused ? FOCUS_MARKER : ' '} ${number}${GUTTER_SEPARATOR}`
    const text = (lines[at - 1] ?? '').replace(/\t/g, '  ')
    rendered.push(clipped({ text: `${head}${text}`, cells: args.cells }))

    if (!focused) continue
    const caret = `${' '.repeat(head.length + Math.max(0, args.column - 1))}^`
    rendered.push(clipped({ text: caret, cells: args.cells }))
  }

  return rendered
}

/**
 * Bun maps a runtime stack back to the `.tsx` a source launch started from, but the message quotes
 * the transpiled expression — `jsxDEV_7x81h0kn(Workspace, { covered: props.covered === !0 })` for a
 * line that reads `<Workspace covered={props.covered === true} />`. The frames are trustworthy, so
 * the source they point at is what turns the report back into something typed.
 */
export function annotateCrashStack(args: {
  stack: string
  read: (file: string) => string | null
  cells: number
}): string {
  const out: string[] = []
  let annotated = 0

  for (const line of args.stack.split('\n')) {
    out.push(line)
    if (annotated >= MAX_ANNOTATED_FRAMES) continue

    const frame = parseCrashFrame(line)
    if (frame === null || !isOwnFrame(frame)) continue

    const source = args.read(frame.file)
    if (source === null) continue

    const framed = codeFrame({
      source,
      line: frame.line,
      column: frame.column,
      cells: args.cells,
    })
    if (framed.length === 0) continue

    out.push(...framed, '')
    annotated += 1
  }

  return out.join('\n')
}
