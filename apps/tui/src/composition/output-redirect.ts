import {
  ELogSeverity,
  ESinkLevel,
  ESinkSource,
  consoleTextOf,
  sinkNoticeText,
  severityOfSink,
  truncateSinkText,
  warningTextOf,
  type SinkEntry,
} from '@dltech/atlas-core'

import type { JsonlLog } from '@dltech/atlas-harness'
import { currentNotices, ENoticeTone, notify, tickNotices } from '../ui/notice-store'

const PACKAGE_WARNING_TTL_MS = 15_000

// A provider warning loop emits synchronously once per dropped part, and each publish is a React
// commit — the flood must settle before the screen hears about it.
const PACKAGE_WARNING_FLUSH_MS = 250

const SEVERITY_OF = {
  info: ELogSeverity.Info,
  warn: ELogSeverity.Warn,
  error: ELogSeverity.Error,
} as const

type StreamName = 'stdout' | 'stderr'

type StreamWrite = (
  chunk: unknown,
  encodingOrCallback?: unknown,
  callback?: unknown,
) => boolean

export type OutputRedirect = {
  readonly enableNotices: () => void
  readonly restore: () => void
}

export function installOutputRedirect(args: { log: JsonlLog }): OutputRedirect {
  const warningCounts = new Map<string, number>()
  const warningPublished = new Set<string>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let noticesEnabled = false

  const publishWarnings = (): void => {
    flushTimer = null
    for (const [key, count] of [...warningCounts.entries()]) {
      notify({
        text: `package warning: ${key.slice('package-warning:'.length)}${count > 1 ? ` (${count} occurrences)` : ''} — see logs.jsonl`,
        tone: ENoticeTone.Warn,
        key,
        ttlMs: PACKAGE_WARNING_TTL_MS,
      })
      warningPublished.add(key)
    }
  }

  const entry = (next: SinkEntry): void => {
    const severity = SEVERITY_OF[severityOfSink({ entry: next })]
    args.log.record({
      severity,
      source: 'packages',
      message: truncateSinkText({ text: next.text }),
      data: { sink: next.source },
    })

    if (severity === ELogSeverity.Info) return
    if (!noticesEnabled) return

    const key = `package-warning:${sinkNoticeText({ text: next.text })}`
    tickNotices({ nowMs: Date.now() })
    const liveKeys = new Set(currentNotices().map((notice) => notice.key))
    // Only a published key can be judged against the store: an unpublished one sits in the
    // counts map alone until the flush, and pruning on store absence would erase a burst in
    // progress, keeping only its last key.
    for (const held of warningCounts.keys()) {
      if (warningPublished.has(held) && !liveKeys.has(held)) {
        warningCounts.delete(held)
        warningPublished.delete(held)
      }
    }

    warningCounts.set(key, (warningCounts.get(key) ?? 0) + 1)

    // Publishing is always deferred: notify is a React commit, and running it inside this hook
    // recurses — the commit's own console logging re-enters entry() until the stack blows.
    if (flushTimer !== null) return
    flushTimer = setTimeout(publishWarnings, PACKAGE_WARNING_FLUSH_MS)
    flushTimer.unref?.()
  }

  const hookConsole = (level: ESinkLevel) => {
    return (...data: unknown[]): void => {
      entry({ level, source: ESinkSource.Console, text: consoleTextOf({ args: data }) })
    }
  }

  const prior = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    emitWarning: process.emitWarning,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
  }

  console.log = hookConsole(ESinkLevel.Log)
  console.info = hookConsole(ESinkLevel.Info)
  console.warn = hookConsole(ESinkLevel.Warn)
  console.error = hookConsole(ESinkLevel.Error)
  console.debug = hookConsole(ESinkLevel.Log)

  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    entry({
      level: ESinkLevel.Log,
      source: ESinkSource.ProcessWarning,
      text: warningTextOf({ warning, options: rest[0] }),
    })
  }) as typeof process.emitWarning

  const hookStream = (stream: StreamName, source: ESinkSource.StdoutWrite | ESinkSource.StderrWrite) => {
    const original = prior[stream === 'stdout' ? 'stdoutWrite' : 'stderrWrite'] as StreamWrite
    const write: StreamWrite = function (this: NodeJS.WriteStream, chunk, encodingOrCallback, callback) {
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? new TextDecoder().decode(chunk)
            : undefined
      if (text !== undefined && isLoggableStreamText({ text })) {
        entry({
          level: source === ESinkSource.StderrWrite ? ESinkLevel.Error : ESinkLevel.Log,
          source,
          text,
        })
      }
      return original.call(this, chunk, encodingOrCallback, callback)
    }
    process[stream].write = write as typeof process.stdout.write
  }

  hookStream('stderr', ESinkSource.StderrWrite)
  hookStream('stdout', ESinkSource.StdoutWrite)

  return {
    enableNotices: () => {
      noticesEnabled = true
    },
    restore: () => {
      console.log = prior.log
      console.info = prior.info
      console.warn = prior.warn
      console.error = prior.error
      console.debug = prior.debug
      process.emitWarning = prior.emitWarning
      process.stderr.write = prior.stderrWrite
      process.stdout.write = prior.stdoutWrite
    },
  }
}

const ANSI_ESCAPE = '\u001b'

function isLoggableStreamText({ text }: { text: string }): boolean {
  if (text.includes(ANSI_ESCAPE)) return false
  return text.replaceAll(/[\x00-\x1f\x7f]/g, '').trim().length > 0
}
