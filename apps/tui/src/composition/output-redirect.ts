import {
  ELogSeverity,
  ESinkLevel,
  ESinkSource,
  consoleTextOf,
  isLowSignalSinkText,
  severityOfSink,
  truncateSinkText,
  warningTextOf,
  type SinkEntry,
} from '@dltech/atlas-core'

import type { JsonlLog } from '@dltech/atlas-harness'
import { ENoticeTone, notify } from '../ui/notice-store'

const LOW_SIGNAL_NOTICE_KEY = 'package-noise'
const LOW_SIGNAL_NOTICE_MS = 60_000

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

/**
 * Blanket capture of everything a package can throw at the terminal: console.*, process warnings
 * (Node's default warning printer writes raw to stderr, which is what scribbles over the
 * renderer), and stray stdout/stderr writes. Every entry lands in the op log; a flood reads as
 * one throttled notice instead of a destroyed frame. Hooked from boot onward, passthrough, so
 * Atlas's own pre-renderer prints (launch line, boot failures, resume hints) still reach the
 * terminal — the sink skips control sequences and only records real text.
 *
 * OpenTUI's debug console replaces global.console wholesale when its overlay opens; that is an
 * operator action and it restores on close, so this capture simply pauses underneath it.
 */
export function installOutputRedirect(args: { log: JsonlLog }): OutputRedirect {
  let lowSignalCount = 0
  let lowSignalNoticeAt = 0
  let noticesEnabled = false

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

    if (isLowSignalSinkText(next.text)) {
      lowSignalCount += 1
      const now = Date.now()
      if (now - lowSignalNoticeAt < LOW_SIGNAL_NOTICE_MS) return
      lowSignalNoticeAt = now
      notify({
        text: `${lowSignalCount} package warnings hidden — see logs.jsonl`,
        tone: ENoticeTone.Warn,
        key: LOW_SIGNAL_NOTICE_KEY,
      })
      lowSignalCount = 0
      return
    }

    notify({
      text: `package warning: ${truncateSinkText({ text: next.text })}`,
      tone: ENoticeTone.Warn,
    })
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

// Frame output is ANSI escape sequences (ESC) plus box-drawing; a stray package line is plain
// words. Skipping anything carrying ESC keeps frame traffic out of the log without having to
// know which writes belong to the renderer.
const ANSI_ESCAPE = '\u001b'

function isLoggableStreamText({ text }: { text: string }): boolean {
  if (text.includes(ANSI_ESCAPE)) return false
  return text.replaceAll(/[\x00-\x1f\x7f]/g, '').trim().length > 0
}
