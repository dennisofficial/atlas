export enum ESinkLevel {
  Log = 'log',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export enum ESinkSource {
  Console = 'console',
  ProcessWarning = 'process-warning',
  StderrWrite = 'stderr-write',
  StdoutWrite = 'stdout-write',
}

export type SinkEntry = {
  readonly level: ESinkLevel
  readonly source: ESinkSource
  readonly text: string
}

export const CONSOLE_ARG_LIMIT = 8

export const SINK_TEXT_LIMIT = 2_000

const LOW_SIGNAL_PATTERN = /^\(node:\d+\) Warning: AI SDK Warning/

export function isLowSignalSinkText(text: string): boolean {
  return LOW_SIGNAL_PATTERN.test(text)
}

export function truncateSinkText({ text }: { text: string }): string {
  const flattened = text.replaceAll('\n', ' ⏎ ').trimEnd()
  if (flattened.length <= SINK_TEXT_LIMIT) return flattened
  return `${flattened.slice(0, SINK_TEXT_LIMIT)}…`
}

export function consoleTextOf({ args }: { args: readonly unknown[] }): string {
  const shown = args.slice(0, CONSOLE_ARG_LIMIT).map(formatConsoleArg)
  if (args.length > CONSOLE_ARG_LIMIT) shown.push(`… +${args.length - CONSOLE_ARG_LIMIT} more`)
  return shown.join(' ')
}

export function warningTextOf({
  warning,
  options,
}: {
  warning: unknown
  options: unknown
}): string {
  const type = warningTypeOf({ options })
  const body = typeof warning === 'string' ? warning : warningMessageOf({ warning })
  return type === undefined ? body : `[${type}] ${body}`
}

export function severityOfSink({ entry }: { entry: SinkEntry }): 'info' | 'warn' | 'error' {
  switch (entry.level) {
    case ESinkLevel.Error:
      return 'error'
    case ESinkLevel.Warn:
      return 'warn'
    case ESinkLevel.Info:
      return 'info'
    case ESinkLevel.Log:
      return entry.source === ESinkSource.ProcessWarning ? 'warn' : 'info'
  }
}

function warningTypeOf({ options }: { options: unknown }): string | undefined {
  if (typeof options === 'string') return options
  if (typeof options !== 'object' || options === null) return undefined
  const type = (options as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

function warningMessageOf({ warning }: { warning: unknown }): string {
  if (warning instanceof Error) return warning.stack ?? warning.message
  return String(warning)
}

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try {
    const rendered = JSON.stringify(arg)
    return rendered ?? String(arg)
  } catch {
    return String(arg)
  }
}
