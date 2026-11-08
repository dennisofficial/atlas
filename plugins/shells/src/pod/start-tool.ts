import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  SchemaTool,
  type DeclaredPathField,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { launchShell, newShellId } from './daemon'
import { renderStarted } from './render'
import type { ShellPodState } from './state'

const inputSchema = z.strictObject({
  command: z.string().min(1),
  description: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  input: z.boolean().optional(),
})

const description = [
  'Start a command as a background shell that outlives this turn and return its shellId at once.',
  'Use it for dev servers, watchers and anything that will not finish on its own; bash is for commands you wait on.',
  'Its ending arrives on its own with its output, so never poll for it.',
  'Set input to true when the command will read from stdin, so shell_input can answer it.',
  'Set description to a few words naming what it is for. Set timeoutMs to kill it if it outlives that ceiling.',
].join(' ')

export class ShellTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell'
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
    private readonly ctx: PluginPodContext,
    private readonly state: ShellPodState,
  ) {
    super()
  }

  protected override async run({
    input,
    signal,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const shellId = newShellId()
    const cwd = input.workdir ?? projectDirectory
    let settled: () => void = () => undefined
    this.state.starting.set(
      shellId,
      new Promise<void>((resolve) => {
        settled = resolve
      }),
    )
    try {
      const launched = await launchShell({
        ctx: this.ctx,
        shellId,
        command: input.command,
        cwd,
        timeoutMs: input.timeoutMs,
        input: input.input === true,
        signal,
      })
      if (!launched.ok) return { ok: false, reason: launched.reason }
      if (input.input === true) this.state.inputs.add(shellId)
      await this.ctx.append([
        {
          type: 'background-shell-started',
          shellId,
          command: input.command,
          ...(input.description === undefined ? {} : { description: input.description }),
          cwd,
        },
      ])
      return {
        ok: true,
        output: {
          shellId,
          command: input.command,
          status: launched.value.status,
          pid: launched.value.pid,
        },
        modelText: renderStarted({ shellId }),
      }
    } finally {
      settled()
      this.state.starting.delete(shellId)
    }
  }
}
