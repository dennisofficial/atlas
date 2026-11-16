import { ARTIFACT_LOG_MAX_CHARS } from '@dltech/atlas-wire'

import type { ProcessPort, ThreadId } from '@dltech/atlas-core'

import {
  drainInto,
  shellEnvironment,
  tailBuffer,
  withinReadGrace,
  type TailBuffer,
} from '../shells/shell-process'

export type BuildCommand = { install?: string | undefined; cmd: string; timeoutSec: number }

export type LocalBuild =
  | { ok: true; log: string; durationMs: number }
  | { ok: false; log: string; durationMs: number; failure: string }

type Step = { label: 'install' | 'build'; line: string }

type StepRun = { exitCode: number; timedOut: boolean }

function stepsOf(build: BuildCommand): Step[] {
  return [
    ...(build.install === undefined ? [] : [{ label: 'install' as const, line: build.install }]),
    { label: 'build', line: build.cmd },
  ]
}

const headerOf = (run: StepRun): string => (run.timedOut ? 'timed out' : `exit ${run.exitCode}`)

async function runStep(args: {
  processes: ProcessPort
  dir: string
  step: Step
  threadId: ThreadId | undefined
  deadline: number
  signal: AbortSignal
  log: TailBuffer
}): Promise<StepRun> {
  const handle = args.processes.spawn({
    cmd: ['bash', '-c', args.step.line],
    cwd: args.dir,
    env: shellEnvironment(),
    ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
  })
  const out = drainInto({ stream: handle.stdout, append: args.log.append })
  const err = drainInto({ stream: handle.stderr, append: args.log.append })
  let timedOut = false
  const terminate = (): void => handle.terminate()
  const timer = setTimeout(
    () => {
      timedOut = true
      terminate()
    },
    Math.max(0, args.deadline - Date.now()),
  )
  args.signal.addEventListener('abort', terminate, { once: true })
  try {
    const exitCode = await handle.exited
    await withinReadGrace(Promise.all([out.done, err.done]))
    out.stop()
    err.stop()
    return { exitCode, timedOut }
  } finally {
    clearTimeout(timer)
    args.signal.removeEventListener('abort', terminate)
  }
}

export async function runLocalBuild(args: {
  dir: string
  build: BuildCommand
  processes: ProcessPort
  threadId?: ThreadId | undefined
  signal: AbortSignal
}): Promise<LocalBuild> {
  const startedAt = Date.now()
  const deadline = startedAt + args.build.timeoutSec * 1000
  const log = tailBuffer(ARTIFACT_LOG_MAX_CHARS)

  const settle = (failure: string): LocalBuild => ({
    ok: false,
    failure,
    log: log.tail().text,
    durationMs: Date.now() - startedAt,
  })

  for (const step of stepsOf(args.build)) {
    if (args.signal.aborted) return settle('the developer interrupted the turn during the build')

    const run = await runStep({
      processes: args.processes,
      dir: args.dir,
      step,
      threadId: args.threadId,
      deadline,
      signal: args.signal,
      log,
    })
    log.append(`\n==> ${step.label} (${headerOf(run)})\n`)

    if (run.timedOut) return settle(`${step.label} timed out after ${args.build.timeoutSec}s`)
    if (args.signal.aborted) return settle('the developer interrupted the turn during the build')
    if (run.exitCode !== 0) {
      return settle(`${step.label} failed with exit code ${run.exitCode}`)
    }
  }

  return { ok: true, log: log.tail().text, durationMs: Date.now() - startedAt }
}
