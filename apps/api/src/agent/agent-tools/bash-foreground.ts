import {
  CallInterruptedError,
  EProcessOutcome,
  type ProcessPort,
  type ThreadId,
  type ToolOutcome,
  type ToolOutputChunk,
} from '@dltech/atlas-core'

import {
  MAXIMUM_OUTPUT_CHARACTERS,
  mergeStreams,
  renderBackgroundedText,
  renderModelText,
} from './bash-output'
import {
  messageOf,
  readShell,
  render,
  startShell,
  terminatorFor,
  type Shell,
  type ShellOutput,
} from './shell-process'

export const newShellId = (): string => `shell-${crypto.randomUUID().slice(0, 8)}`

const OOM_KILLED_EXIT_CODE = 137

const adoptShell = async (args: {
  move: NonNullable<Shell['moveToBackground']>
  shellId: string
}): Promise<boolean> => {
  try {
    return await args.move({ shellId: args.shellId })
  } catch {
    return false
  }
}

const readWithinWindow = async (args: {
  shell: Shell
  timeoutMs: number
  shellId: string
  signal: AbortSignal
  onOutput?: ((chunk: ToolOutputChunk) => void) | undefined
}): Promise<{ read: ShellOutput; deadlineFired: boolean }> => {
  const terminate = terminatorFor(args.shell)
  let deadlineFired = false

  const handOver = async (): Promise<void> => {
    const move = args.shell.moveToBackground
    if (move === undefined) {
      terminate()
      return
    }
    const adopted = await adoptShell({ move, shellId: args.shellId })
    if (!adopted) terminate()
  }

  const deadline = setTimeout(() => {
    deadlineFired = true
    void handOver()
  }, args.timeoutMs)
  args.signal.addEventListener('abort', terminate, { once: true })
  try {
    const read = await readShell({
      shell: args.shell,
      limit: MAXIMUM_OUTPUT_CHARACTERS,
      ...(args.onOutput === undefined ? {} : { onOutput: args.onOutput }),
    })
    return { read, deadlineFired }
  } finally {
    clearTimeout(deadline)
    args.signal.removeEventListener('abort', terminate)
  }
}

export async function runForeground(args: {
  command: string
  description: string
  cwd: string
  timeoutMs: number
  maximumTimeoutMs: number
  processes: ProcessPort
  env: Record<string, string>
  threadId: ThreadId
  signal: AbortSignal
  onOutput?: ((chunk: ToolOutputChunk) => void) | undefined
}): Promise<ToolOutcome> {
  const started = startShell({
    command: args.command,
    cwd: args.cwd,
    processes: args.processes,
    env: () => args.env,
    threadId: args.threadId,
  })
  if (!started.ok) return started

  const shellId = newShellId()
  let waited: { read: ShellOutput; deadlineFired: boolean }
  try {
    waited = await readWithinWindow({
      shell: started.shell,
      timeoutMs: args.timeoutMs,
      shellId,
      signal: args.signal,
      onOutput: args.onOutput,
    })
  } catch (error) {
    if (error instanceof CallInterruptedError) throw error
    return { ok: false, reason: `the command could not be read back: ${messageOf(error)}` }
  }

  const { read, deadlineFired } = waited
  const merged = mergeStreams({ stdout: read.stdout, stderr: read.stderr })

  if (read.outcome.kind === EProcessOutcome.Backgrounded) {
    return {
      ok: true,
      output: {
        command: args.command,
        description: args.description,
        shellId: read.outcome.shellId,
        backgrounded: true,
        timedOut: false,
        stdout: render(read.stdout),
        stderr: render(read.stderr),
        truncated: merged.truncated,
      },
      modelText: renderBackgroundedText({
        command: args.command,
        shellId: read.outcome.shellId,
        merged: merged.text,
        timeoutMs: args.timeoutMs,
      }),
    }
  }

  const oomKilled = read.outcome.kind === EProcessOutcome.OomKilled
  const memory = read.outcome.kind === EProcessOutcome.OomKilled ? read.outcome.memory : undefined
  const timedOut = deadlineFired && !oomKilled

  if (args.signal.aborted && !timedOut && !oomKilled) {
    return {
      ok: false,
      reason: 'the operator interrupted the turn while the command was running',
    }
  }

  if (read.outcome.kind === EProcessOutcome.Failed) {
    return {
      ok: false,
      reason: `the command could not be run to completion (${read.outcome.code}): ${read.outcome.message}`,
    }
  }

  const exitCode =
    read.outcome.kind === EProcessOutcome.Exited ? read.outcome.code : OOM_KILLED_EXIT_CODE

  return {
    ok: true,
    output: {
      command: args.command,
      description: args.description,
      exitCode,
      stdout: render(read.stdout),
      stderr: render(read.stderr),
      truncated: merged.truncated,
      timedOut,
      ...(oomKilled ? { oomKilled: true } : {}),
    },
    modelText: renderModelText({
      command: args.command,
      merged: merged.text,
      exitCode,
      timedOut,
      oomKilled,
      memory,
      timeoutMs: args.timeoutMs,
      maximumTimeoutMs: args.maximumTimeoutMs,
    }),
  }
}
