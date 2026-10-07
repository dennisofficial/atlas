import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sandboxNameFor } from '@dltech/atlas-harness'

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_KILL_GRACE_MS = 5_000
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'] as const

type ForwardedSignal = (typeof FORWARDED_SIGNALS)[number]

type Outcome =
  | { kind: 'exited'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'interrupted'; signal: ForwardedSignal }
  | { kind: 'spawn-failed'; message: string }

type Supervision = {
  entry: string
  input: string
  cwd: string
  env: NodeJS.ProcessEnv
  stdout: number
  stderr: number
  timeoutMs: number
  killGraceMs: number
}

const supervise = (args: Supervision): Promise<Outcome> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [args.entry, `--worker=${args.input}`], {
      cwd: args.cwd,
      env: args.env,
      detached: true,
      stdio: ['ignore', args.stdout, args.stderr],
    })
    let spawned = false
    let stopping: Outcome | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let reaper: ReturnType<typeof setTimeout> | undefined

    const killGroup = (signal: NodeJS.Signals): void => {
      if (!spawned || child.pid === undefined) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        return
      }
    }

    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = () => stop({ kind: 'interrupted', signal })
      process.on(signal, handler)
      return { signal, handler }
    })

    const finish = (outcome: Outcome): void => {
      clearTimeout(deadline)
      clearTimeout(escalation)
      clearTimeout(reaper)
      for (const { signal, handler } of handlers) process.off(signal, handler)
      resolve(outcome)
    }

    const beginStop = (): void => {
      killGroup('SIGTERM')
      escalation = setTimeout(() => {
        killGroup('SIGKILL')
        reaper = setTimeout(() => finish(stopping ?? { kind: 'timeout', timeoutMs: 0 }), args.killGraceMs)
      }, args.killGraceMs)
    }

    const stop = (outcome: Outcome): void => {
      if (stopping !== undefined) return
      stopping = outcome
      if (spawned) beginStop()
    }

    const deadline = setTimeout(
      () => stop({ kind: 'timeout', timeoutMs: args.timeoutMs }),
      args.timeoutMs,
    )

    child.on('spawn', () => {
      spawned = true
      if (stopping !== undefined) beginStop()
    })
    child.on('error', (error) => {
      if (!spawned) finish(stopping ?? { kind: 'spawn-failed', message: error.message })
    })
    child.on('exit', (code, signal) => {
      if (stopping === undefined) return finish({ kind: 'exited', code, signal })
      killGroup('SIGKILL')
      finish(stopping)
    })
  })

const recoverySandboxName = async (directory: string): Promise<string | undefined> => {
  let text: string
  try {
    text = await readFile(join(directory, 'timeline.jsonl'), 'utf8')
  } catch {
    return undefined
  }
  let derived: string | undefined
  for (const line of text.split('\n')) {
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const phase: unknown = Reflect.get(entry, 'phase')
    const sandboxName: unknown = Reflect.get(entry, 'sandboxName')
    const threadId: unknown = Reflect.get(entry, 'threadId')
    if (phase === 'failure' && typeof sandboxName === 'string') return sandboxName
    if (phase === 'fixture' && derived === undefined && typeof threadId === 'string')
      derived = sandboxNameFor({ threadId })
  }
  return derived
}

const describeOutcome = (outcome: Outcome): string => {
  if (outcome.kind === 'timeout')
    return `exceeded the ${outcome.timeoutMs}ms whole-sample deadline and was killed`
  if (outcome.kind === 'interrupted') return `was stopped by ${outcome.signal} and killed`
  if (outcome.kind === 'spawn-failed') return `could not start: ${outcome.message}`
  if (outcome.signal !== null) return `was terminated by ${outcome.signal}`
  return `exited with status ${outcome.code}`
}

const failureMessage = async (args: { outcome: Outcome; directory: string }): Promise<string> => {
  const sandboxName = await recoverySandboxName(args.directory)
  const recovery =
    sandboxName === undefined
      ? 'no benchmark sandbox was recorded'
      : `benchmark sandbox to inspect or delete: ${sandboxName}`
  return `benchmark worker ${describeOutcome(args.outcome)}; artifact directory: ${args.directory}; ${recovery}; private diagnostics: process.stdout, process.stderr and timeline.jsonl in that directory`
}

export const runBenchmarkWorker = async (args: {
  entry: string
  input: string
  cwd: string
  directory: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
  killGraceMs?: number
}): Promise<void> => {
  const stdout = openSync(join(args.directory, 'process.stdout'), 'wx', 0o600)
  let stderr: number | undefined
  let outcome: Outcome
  try {
    stderr = openSync(join(args.directory, 'process.stderr'), 'wx', 0o600)
    outcome = await supervise({
      entry: args.entry,
      input: args.input,
      cwd: args.cwd,
      env: args.env,
      stdout,
      stderr,
      timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killGraceMs: args.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    })
  } finally {
    closeSync(stdout)
    if (stderr !== undefined) closeSync(stderr)
  }
  if (outcome.kind === 'exited' && outcome.code === 0) return
  throw new Error(await failureMessage({ outcome, directory: args.directory }))
}
