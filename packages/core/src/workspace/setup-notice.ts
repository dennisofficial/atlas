export enum ESetupPhase {
  Started = 'started',
  Finished = 'finished',
}

const INLINE_SCRIPT_CHARS = 80
const SCRIPT_LINE_LIMIT = 20
const OUTPUT_TAIL_CHARS = 4_000
const ELLIPSIS = '…'

const fenceOf = (body: string): string => {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}sh\n${body}\n${fence}`
}

const scriptOf = (script: string): string => {
  const trimmed = script.trim()
  const lines = trimmed.split('\n')
  if (lines.length === 1 && trimmed.length <= INLINE_SCRIPT_CHARS && !trimmed.includes('`')) {
    return `\`${trimmed}\``
  }
  const shown = lines.slice(0, SCRIPT_LINE_LIMIT)
  const hidden = lines.length - shown.length
  const more = hidden === 0 ? [] : [`${ELLIPSIS} ${hidden} more lines`]
  return fenceOf([...shown, ...more].join('\n'))
}

const durationOf = (durationMs: number): string => {
  const seconds = Math.max(0, durationMs) / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

const outputTailOf = (output: string): string => {
  const trimmed = output.trim()
  if (trimmed.length <= OUTPUT_TAIL_CHARS) return trimmed
  return `${ELLIPSIS}${trimmed.slice(trimmed.length - OUTPUT_TAIL_CHARS)}`
}

export const setupStartedText = (args: { script: string }): string =>
  [
    `The project setup script started in the background: ${scriptOf(args.script)}`,
    'It installs the dependencies and tools this workspace needs, so anything that fails on a missing dependency may work once it ends. A notice follows when it does.',
  ].join('\n\n')

export const setupFinishedText = (args: {
  script: string
  ok: boolean
  durationMs: number
  output: string
}): string => {
  const head = `The project setup script ${args.ok ? 'finished' : 'failed'} after ${durationOf(args.durationMs)}: ${scriptOf(args.script)}`
  if (args.ok) {
    return `${head}\n\nThe dependencies and tools it installs are in place now, so retry whatever failed on them.`
  }
  const tail = outputTailOf(args.output)
  if (tail === '') return `${head}\n\nIt ended without any output.`
  return `${head}\n\nIts output:\n\n${fenceOf(tail)}`
}
