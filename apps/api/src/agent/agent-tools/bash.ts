import { z } from 'zod'

import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  CallInterruptedError,
  EProcessOutcome,
  EToolEffect,
  FileSystemPort,
  ProcessPort,
  SchemaTool,
  doesNothing,
  truncatesWatch,
  waitsBySleeping,
  waitsByWatching,
  withFallbackShellName,
  type DeclaredPathField,
  type ThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import {
  messageOf,
  readShell,
  render,
  startShell,
  terminatorFor,
  type ShellOutput,
} from './shell-process'
import { ShellRegistryPort } from './shell-port'
import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
} from '../runtime/session-paths'
import { MAXIMUM_OUTPUT_CHARACTERS, mergeStreams, renderModelText } from './bash-output'
import {
  bashDescription,
  ceilingClause,
  idlingRefusal,
  noOpRefusal,
  truncatedWatchRefusal,
  watchClause,
  watchRefusal,
} from './bash-prose'

const DEFAULT_TIMEOUT_MS = 120_000
const MAXIMUM_TIMEOUT_MS = 600_000

const inputSchema = withFallbackShellName(
  z.strictObject({
    description: z.string().min(1),
    command: z.string().min(1),
    workdir: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    runInBackground: z.boolean().optional(),
    watch: z.string().min(1).optional(),
  }),
)

const description = bashDescription({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maximumTimeoutMs: MAXIMUM_TIMEOUT_MS,
})

export class BashTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'bash'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'workdir',
      presence: EPathPresence.Optional,
      form: EPathForm.Absolute,
      content: EContentAccess.None,
    },
  ]

  constructor(
    private readonly shells: ShellRegistryPort,
    private readonly files: FileSystemPort,
    private readonly processes: ProcessPort,
    private readonly shellEnv?: (() => Promise<Record<string, string>>) | undefined,
  ) {
    super()
  }

  private async startInBackground(args: {
    threadId: ThreadId
    command: string
    description: string
    cwd: string
    watch?: string | undefined
    timeoutMs?: number | undefined
  }): Promise<ToolOutcome> {
    const started = await this.shells.start(args)
    if (!started.ok) return started

    const { shellId } = started.snapshot

    return {
      ok: true,
      output: {
        command: args.command,
        description: args.description,
        shellId,
        status: started.snapshot.status,
        pid: started.snapshot.pid,
        outputPath: started.snapshot.outputPath,
        ...(args.watch === undefined ? {} : { watch: args.watch }),
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      },
      modelText: [
        `Started in the background as shell ${shellId}, and it outlives this turn.`,
        'It outlives an interrupt too: stopping a turn stops the turn, not the shell. The command needs no nohup,',
        'setsid, detached subprocess or sentinel file. Its supervisor keeps output, input and exit status across Atlas restarts.',
        'Quitting detaches by default. shell_kill, a confirmed stop and an execution-location move stop the command.',
        'Its ending is delivered with a bounded output excerpt and the full output file path.',
        'shell_input answers a prompt. An interactive terminal program still needs a terminal, not this pipe.',
        ...(started.snapshot.outputPath === undefined
          ? []
          : [
              `Output is being written to: ${started.snapshot.outputPath}. Use Read or Grep on that file for full history.`,
            ]),
        'A kill you asked for lands that way too: shell_kill waits for the death and hands you everything the shell printed as its result.',
        'The ending is also written to the durable log and announced like every other ending, so you can be told the same death twice - once as the tool result, once as the ending.',
        ...watchClause({ watch: args.watch }),
        ...ceilingClause({ timeoutMs: args.timeoutMs }),
        'Do not wait on it: no sleeping, no polling, no idle loop, no do-nothing command to pass the time. A tick only spins the turn. Take other work, or end the turn and be woken.',
        `Use shell_output({ shellId: "${shellId}" }) for unread output. Use shell_input to send input. Use shell_kill to stop it.`,
        `${ATLAS_SESSION_DIR_ENV} and ${ATLAS_THREAD_DIR_ENV} locate the session and thread data of this agent. ${ATLAS_CONTEXT_DIR_ENV} locates the shared context folder of the session. ATLAS_SHELL_DIR locates the spool of this shell.`,
      ].join(' '),
    }
  }

  protected override async run({
    input,
    signal,
    projectDirectory,
    threadId,
    onOutput,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (signal.aborted)
      return { ok: false, reason: 'the operator interrupted the turn before the command started' }

    const { command, timeoutMs } = input
    const cwd = input.workdir ?? projectDirectory

    if (input.watch !== undefined && input.runInBackground !== true) {
      return {
        ok: false,
        reason:
          'watch reads the lines of a shell that is still running, so it needs runInBackground: true. A foreground command hands you all of its output the moment it returns, so there is nothing for a watch to be earlier than',
      }
    }

    if (input.workdir !== undefined) {
      const directory = await this.files.stat({ path: input.workdir }).catch(() => undefined)
      if (directory === undefined) {
        return {
          ok: false,
          reason: `workdir ${input.workdir} does not exist, so there is nowhere to run the command`,
        }
      }
      if (!directory.isDirectory()) {
        return { ok: false, reason: `workdir ${input.workdir} is a file, not a directory` }
      }
    }

    if (truncatesWatch({ command })) {
      return { ok: false, reason: truncatedWatchRefusal() }
    }

    if (input.runInBackground === true) {
      return this.startInBackground({
        threadId,
        command,
        description: input.description,
        cwd,
        watch: input.watch,
        timeoutMs,
      })
    }

    const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAXIMUM_TIMEOUT_MS)

    if (doesNothing({ command })) {
      return { ok: false, reason: noOpRefusal() }
    }

    if (waitsBySleeping({ command, timeoutMs: timeout })) {
      return { ok: false, reason: idlingRefusal({ command, timeoutMs: timeout }) }
    }

    if (waitsByWatching({ command })) {
      return { ok: false, reason: watchRefusal() }
    }

    const env = this.shellEnv === undefined ? {} : await this.shellEnv()
    const started = startShell({
      command,
      cwd,
      processes: this.processes,
      env: () => env,
      threadId,
    })
    if (!started.ok) return started

    const { shell } = started
    const terminate = terminatorFor(shell)
    let deadlineFired = false
    const deadline = setTimeout(() => {
      deadlineFired = true
      terminate()
    }, timeout)
    signal.addEventListener('abort', terminate, { once: true })

    let read: ShellOutput
    try {
      read = await readShell({
        shell,
        limit: MAXIMUM_OUTPUT_CHARACTERS,
        ...(onOutput === undefined ? {} : { onOutput }),
      })
    } catch (error) {
      if (error instanceof CallInterruptedError) throw error
      return { ok: false, reason: `the command could not be read back: ${messageOf(error)}` }
    } finally {
      clearTimeout(deadline)
      signal.removeEventListener('abort', terminate)
    }

    const oomKilled = read.outcome.kind === EProcessOutcome.OomKilled
    const memory = read.outcome.kind === EProcessOutcome.OomKilled ? read.outcome.memory : undefined
    const timedOut = deadlineFired && !oomKilled

    if (signal.aborted && !deadlineFired && !oomKilled) {
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

    const exitCode = read.outcome.kind === EProcessOutcome.Exited ? read.outcome.code : 137
    const merged = mergeStreams({ stdout: read.stdout, stderr: read.stderr })

    return {
      ok: true,
      output: {
        command,
        description: input.description,
        exitCode,
        stdout: render(read.stdout),
        stderr: render(read.stderr),
        truncated: merged.truncated,
        timedOut,
        ...(oomKilled ? { oomKilled: true } : {}),
      },
      modelText: renderModelText({
        command,
        merged: merged.text,
        exitCode,
        timedOut,
        oomKilled,
        memory,
        timeoutMs: timeout,
        maximumTimeoutMs: MAXIMUM_TIMEOUT_MS,
      }),
    }
  }
}
