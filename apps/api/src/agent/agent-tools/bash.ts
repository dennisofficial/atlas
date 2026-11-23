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
  withFallbackShellName,
  type DeclaredPathField,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { startBackgroundShell } from './bash-background'
import { runForeground } from './bash-foreground'
import {
  bashDescription,
  idlingRefusal,
  noOpRefusal,
  truncatedWatchRefusal,
  watchRefusal,
} from './bash-prose'
import type { ShellLauncher } from './shell-launcher'

const DEFAULT_TIMEOUT_MS = 120_000
const MAXIMUM_TIMEOUT_MS = 600_000

const inputSchema = withFallbackShellName(
  z.strictObject({
    description: z.string().min(1),
    command: z.string().min(1),
    workdir: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    background: z.boolean().optional(),
    input: z.boolean().optional(),
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
    private readonly deps: {
      launcher: ShellLauncher
      files: FileSystemPort
      processes: ProcessPort
      shellEnv?: (() => Promise<Record<string, string>>) | undefined
    },
  ) {
    super()
  }

  private async shellEnvOf(): Promise<Record<string, string>> {
    return this.deps.shellEnv === undefined ? {} : this.deps.shellEnv()
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

    if (input.workdir !== undefined) {
      const directory = await this.deps.files.stat({ path: input.workdir }).catch(() => undefined)
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

    const wantsInput = input.input === true
    if (input.background === true || wantsInput) {
      return startBackgroundShell({
        launcher: this.deps.launcher,
        command,
        description: input.description,
        cwd,
        env: await this.shellEnvOf(),
        timeoutMs,
        input: wantsInput,
        movedForInput: wantsInput && input.background !== true,
        signal,
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

    return runForeground({
      command,
      description: input.description,
      cwd,
      timeoutMs: timeout,
      maximumTimeoutMs: MAXIMUM_TIMEOUT_MS,
      processes: this.deps.processes,
      env: await this.shellEnvOf(),
      threadId,
      signal,
      onOutput,
    })
  }
}
