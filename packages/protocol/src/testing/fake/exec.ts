import { defineOp, type CallContext, type DaemonGroupFactory } from '../../engine'
import {
  CallFailureError,
  ECallFailure,
  EExecOutcome,
  type ExecOp,
  type ExecResult,
} from '../../ops'
import type { MemoryFileSystem } from '../memory-files'

type ScriptStep =
  | { kind: 'output'; text: string }
  | { kind: 'sleep'; ms: number }
  | { kind: 'exit'; code: number }
  | { kind: 'write'; path: string; bytes: Uint8Array }
  | { kind: 'noop' }

const unquote = (text: string): string => text.trim().replace(/^['"]|['"]$/g, '')

const parseCommand = (command: string): ScriptStep => {
  const trimmed = command.trim().replace(/\s*1?>&2\s*$/, '')
  if (trimmed === '' || trimmed === 'cat' || trimmed === 'true' || trimmed === ':') {
    return { kind: 'noop' }
  }
  const echo = /^echo\s+(.*)$/.exec(trimmed)
  if (echo?.[1] !== undefined) return { kind: 'output', text: `${unquote(echo[1])}\n` }
  const sleep = /^sleep\s+([\d.]+)$/.exec(trimmed)
  if (sleep?.[1] !== undefined) return { kind: 'sleep', ms: Math.ceil(Number(sleep[1]) * 1000) }
  const exit = /^exit\s+(\d+)$/.exec(trimmed)
  if (exit?.[1] !== undefined) return { kind: 'exit', code: Number(exit[1]) }
  const decode = /^printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d > (\S+)$/.exec(trimmed)
  if (decode?.[1] !== undefined && decode[2] !== undefined) {
    return {
      kind: 'write',
      path: decode[2],
      bytes: new Uint8Array(Buffer.from(decode[1], 'base64')),
    }
  }
  const printf = /^printf '%s' '([^']*)'$/.exec(trimmed)
  if (printf?.[1] !== undefined) return { kind: 'output', text: printf[1] }
  return { kind: 'output', text: `fake exec cannot run: ${trimmed}\n` }
}

const scriptOf = (argv: readonly string[]): readonly ScriptStep[] => {
  const [executable, flag, script] = argv
  if (executable === 'cat' || executable === 'true') return [{ kind: 'noop' }]
  if (executable !== '/bin/sh' || flag !== '-c' || script === undefined) {
    throw new CallFailureError({
      code: ECallFailure.SpawnFailed,
      message: `ENOENT: no such file or directory, posix_spawn '${executable ?? ''}'`,
    })
  }
  return script.split(/;|&&|\n/).map(parseCommand)
}

const pause = (args: { ms: number; signal: AbortSignal }): Promise<void> =>
  new Promise((resolve) => {
    if (args.signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, args.ms)
    args.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

const runScript = async (args: {
  op: ExecOp
  ctx: CallContext
  fs: MemoryFileSystem
  signal: AbortSignal
}): Promise<{ exitCode: number; written: number }> => {
  let written = 0
  for (const step of scriptOf(args.op.argv)) {
    if (args.signal.aborted) break
    if (step.kind === 'output') {
      const bytes = new TextEncoder().encode(step.text)
      written += bytes.length
      args.ctx.output(bytes)
    }
    if (step.kind === 'sleep') await pause({ ms: step.ms, signal: args.signal })
    if (step.kind === 'write') args.fs.writeFile({ path: step.path, content: step.bytes })
    if (step.kind === 'exit') return { exitCode: step.code, written }
  }
  return { exitCode: 0, written }
}

const fakeExec = async (args: {
  op: ExecOp
  ctx: CallContext
  fs: MemoryFileSystem
}): Promise<ExecResult> => {
  const { op, ctx } = args
  if (op.cwd !== undefined && !args.fs.exists({ path: op.cwd })) {
    throw new CallFailureError({
      code: ECallFailure.SpawnFailed,
      message: `ENOENT: no such file or directory, posix_spawn '${op.argv[0] ?? ''}'`,
    })
  }
  const timeout = new AbortController()
  const timer =
    op.timeoutMs === undefined ? undefined : setTimeout(() => timeout.abort(), op.timeoutMs)
  const signal = AbortSignal.any([ctx.signal, timeout.signal])
  try {
    const { exitCode, written } = await runScript({ op, ctx, fs: args.fs, signal })
    if (ctx.signal.aborted) {
      return {
        exitCode: null,
        signal: 'SIGTERM',
        outcome: EExecOutcome.Cancelled,
        outputBytes: written,
      }
    }
    if (timeout.signal.aborted) {
      return {
        exitCode: null,
        signal: 'SIGTERM',
        outcome: EExecOutcome.TimedOut,
        outputBytes: written,
      }
    }
    return { exitCode, signal: null, outcome: EExecOutcome.Exited, outputBytes: written }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export const fakeExecGroup =
  (args: { fs: MemoryFileSystem }): DaemonGroupFactory =>
  () => ({
    name: 'exec',
    ops: [defineOp({ op: 'exec', run: ({ op, ctx }) => fakeExec({ op, ctx, fs: args.fs }) })],
  })
