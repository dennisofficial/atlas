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

import { launchService } from './launch'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({
  description: z.string().min(1),
  command: z.string().min(1),
  workdir: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  readyTimeoutMs: z.number().int().positive().optional(),
})

const description = [
  'Start a long-running service - a dev server, a database, a cache, anything that keeps serving until it is stopped - and get its id back at once.',
  'This is not for work you are waiting on: a command that ends and whose result you need belongs on bash.',
  'A monitor that exits when what it watches finishes - a CI watch, a log tail - is a background shell, not a service.',
  'A service never times out and never holds the turn open; if it dies you will be told, wherever you are.',
  'Its stdin is closed and it is its own process group, so nothing it forks outlives a stop.',
  'Pass port when the service listens on one: the call then waits until that port answers, up to readyTimeoutMs, and the service is recorded as ready.',
  'It runs with PORT set to that port, so listen on $PORT.',
  'Its ending arrives on its own; do not poll.',
].join(' ')

export class ServiceStartTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_start'
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
    private readonly state: ServicePodState,
  ) {
    super()
  }

  protected override async run({
    input,
    signal,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    return launchService({
      ctx: this.ctx,
      state: this.state,
      command: input.command,
      description: input.description,
      cwd: input.workdir ?? projectDirectory,
      port: input.port,
      readyTimeoutMs: input.readyTimeoutMs,
      signal,
    })
  }
}
