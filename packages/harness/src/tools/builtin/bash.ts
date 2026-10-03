import { z } from 'zod'

import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  FileSystemPort,
  ProcessPort,
  SchemaTool,
  doesNothing,
  truncatesWatch,
  waitsBySleeping,
  waitsByWatching,
  type DeclaredPathField,
  type PortExposure,
  type ThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { LocalProcessPort } from '../../execution/local-process'
import {
  messageOf,
  readShell,
  render,
  startShell,
  terminatorFor,
  type ShellOutput,
} from '../../shells/shell-process'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { MAXIMUM_OUTPUT_CHARACTERS, mergeStreams, renderModelText } from './bash-output'
import {
  bashDescription,
  ceilingClause,
  exposureClause,
  exposureNeedsBackground,
  exposureUnsupported,
  idlingRefusal,
  noOpRefusal,
  truncatedWatchRefusal,
  watchClause,
  watchRefusal,
} from './bash-prose'

const DEFAULT_TIMEOUT_MS = 120_000
const MAXIMUM_TIMEOUT_MS = 600_000

const inputSchema = z.strictObject({
  command: z.string().min(1),
  workdir: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  description: z.string().min(1),
  runInBackground: z.boolean().optional(),
  watch: z.string().min(1).optional(),
  outputLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  exposePort: z.number().int().min(1).max(65_535).optional(),
})

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
    private readonly files: FileSystemPort = new LocalFileSystemPort(),
    private readonly processes: ProcessPort = new LocalProcessPort(),
  ) {
    super()
  }

  private async resolveExposure(args: {
    containerPort: number | undefined
    threadId: ThreadId
  }): Promise<{ ok: true; exposure: PortExposure | undefined } | { ok: false; reason: string }> {
    if (args.containerPort === undefined) return { ok: true, exposure: undefined }
    if (this.processes.exposePort === undefined) {
      return { ok: false, reason: exposureUnsupported() }
    }

    return await this.processes.exposePort({
      containerPort: args.containerPort,
      threadId: args.threadId,
    })
  }

  private async startInBackground(args: {
    threadId: ThreadId
    command: string
    description: string
    cwd: string
    watch?: string | undefined
    timeoutMs?: number | undefined
    outputLimitBytes?: number | undefined
    exposure?: PortExposure | undefined
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
        outputLimitBytes: args.outputLimitBytes ?? 5 * 1024 ** 3,
        ...(args.exposure === undefined ? {} : { exposure: args.exposure }),
      },
      modelText: [
        `Started in the background as shell ${shellId}, and it outlives this turn.`,
        'It outlives an interrupt too: stopping a turn stops the turn, not the shell, so nothing here needed nohup,',
        'setsid, a detached subprocess or a sentinel file. Its supervisor preserves output, input, and exit status across Atlas restarts.',
        'Quitting detaches by default; shell_kill, a confirmed stop, and execution-location moves stop the command.',
        'Its ending will be delivered with a bounded output excerpt and the full output file path.',
        'A prompt can be answered with shell_input; interactive terminal programs still require a terminal, not this pipe.',
        ...(started.snapshot.outputPath === undefined ? [] : [
          `Output is being written to: ${started.snapshot.outputPath}. Use Read or Grep on that file for full history.`,
        ]),
        'A kill you asked for still lands that way: shell_kill waits for the death and hands you everything the shell printed as its result,',
        'and the ending is written to the durable log and announced like every other, so you can be told the same death twice - once as the tool result, once as the ending.',
        ...watchClause({ watch: args.watch }),
        ...ceilingClause({ timeoutMs: args.timeoutMs }),
        ...exposureClause({ exposure: args.exposure }),
        'So do not wait on it: no sleeping, no polling, no idle loop, and no do-nothing command to pass the time - a tick only spins the turn. Take up other work, or end the turn and be woken.',
        `Use shell_output({ shellId: "${shellId}" }) for unread output, shell_input to send input, and shell_kill to stop it.`,
        'ATLAS_SESSION_DIR and ATLAS_THREAD_DIR locate this agent’s session and thread data; ATLAS_SHELL_DIR locates this shell’s spool.',
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
    if (signal.aborted) return { ok: false, reason: 'the developer interrupted the turn before the command started' }

    const { command, timeoutMs } = input
    const cwd = input.workdir ?? projectDirectory

    if (input.watch !== undefined && input.runInBackground !== true) {
      return {
        ok: false,
        reason:
          'watch reads the lines of a shell that is still running, so it needs runInBackground: true; a foreground command hands you all of its output the moment it returns, so there is nothing for a watch to be earlier than',
      }
    }

    if (input.outputLimitBytes !== undefined && input.runInBackground !== true) {
      return { ok: false, reason: 'outputLimitBytes is the durable background command’s kernel file-size cap; use runInBackground to configure it' }
    }

    if (input.exposePort !== undefined && input.runInBackground !== true) {
      return { ok: false, reason: exposureNeedsBackground() }
    }

    if (input.workdir !== undefined) {
      const directory = await this.files.stat({ path: input.workdir }).catch(() => undefined)
      if (directory === undefined) {
        return { ok: false, reason: `workdir ${input.workdir} does not exist, so there is nowhere to run the command` }
      }
      if (!directory.isDirectory()) {
        return { ok: false, reason: `workdir ${input.workdir} is a file, not a directory` }
      }
    }

    if (truncatesWatch({ command })) {
      return { ok: false, reason: truncatedWatchRefusal() }
    }

    if (input.runInBackground === true) {
      const exposure = await this.resolveExposure({
        containerPort: input.exposePort,
        threadId,
      })
      if (!exposure.ok) return exposure

      return this.startInBackground({
        threadId,
        command,
        description: input.description,
        cwd,
        watch: input.watch,
        timeoutMs,
        outputLimitBytes: input.outputLimitBytes,
        exposure: exposure.exposure,
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

    const started = startShell({ command, cwd, processes: this.processes, threadId })
    if (!started.ok) return started

    const { shell } = started
    const terminate = terminatorFor(shell)
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
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
      return { ok: false, reason: `the command could not be read back: ${messageOf(error)}` }
    } finally {
      clearTimeout(deadline)
      signal.removeEventListener('abort', terminate)
    }

    if (signal.aborted && !timedOut) {
      return { ok: false, reason: 'the developer interrupted the turn while the command was running' }
    }

    const merged = mergeStreams({ stdout: read.stdout, stderr: read.stderr })

    return {
      ok: true,
      output: {
        command,
        description: input.description,
        exitCode: read.exitCode,
        stdout: render(read.stdout),
        stderr: render(read.stderr),
        truncated: merged.truncated,
        timedOut,
      },
      modelText: renderModelText({
        merged: merged.text,
        exitCode: read.exitCode,
        timedOut,
        timeoutMs: timeout,
        maximumTimeoutMs: MAXIMUM_TIMEOUT_MS,
      }),
    }
  }
}
