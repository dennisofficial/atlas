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

import { readDeclared } from './declared-file'
import { ensureDeclared } from './declared-ensure'
import { launchService } from './launch'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({
  description: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  readyTimeoutMs: z.number().int().positive().optional(),
})

const description = [
  'Start a long-running service - a dev server, a database, a cache, anything that keeps serving until it is stopped - and get its id back at once.',
  'Pass name to start a service the project declares in .atlas/services.yaml: it starts what that service needs first, runs its setup once, and uses its command, working directory, env and port.',
  'Pass command instead to start an ad-hoc one yourself; pass only one of the two.',
  'This is not for work you are waiting on: a command that ends and whose result you need belongs on bash.',
  'A monitor that exits when what it watches finishes - a CI watch, a log tail - is a background shell, not a service.',
  'A service never times out and never holds the turn open; if it dies you will be told, wherever you are.',
  'Its stdin is closed and it is its own process group, so nothing it forks outlives a stop.',
  'A port makes the call wait until that port answers, up to readyTimeoutMs, and the service is recorded as ready.',
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
    if (input.name !== undefined && input.command !== undefined) {
      return {
        ok: false,
        reason:
          'service_start takes a declared name or a command, not both: drop the one you did not mean to pass',
      }
    }
    if (input.name === undefined && input.command === undefined) {
      return {
        ok: false,
        reason:
          'service_start needs a name - a service declared in .atlas/services.yaml - or a command',
      }
    }
    if (input.name !== undefined) {
      const declared = await readDeclared({ ctx: this.ctx, projectDirectory, signal })
      if (!declared.ok) return declared
      return ensureDeclared({
        ctx: this.ctx,
        state: this.state,
        declared: declared.value,
        name: input.name,
        projectDirectory,
        readyTimeoutMs: input.readyTimeoutMs,
        signal,
      })
    }
    return launchService({
      ctx: this.ctx,
      state: this.state,
      command: input.command ?? '',
      description: input.description ?? input.command ?? '',
      cwd: input.workdir ?? projectDirectory,
      port: input.port,
      readyTimeoutMs: input.readyTimeoutMs,
      signal,
    })
  }
}
