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

import { SERVICES_DESCRIPTION } from './description'
import { listServiceRows } from './list'
import { restartService } from './restart'
import { EServiceAction, type ServiceInput, serviceInputSchema } from './schema'
import { startService } from './start'
import type { ServicePodState } from './state'
import { stopServiceAction } from './stop'
import { placeOf } from './tool-place'

export class ServiceTool extends SchemaTool<typeof serviceInputSchema> {
  readonly name = 'service'
  readonly description = SERVICES_DESCRIPTION
  readonly effect = EToolEffect.Write
  override readonly isConcurrencySafe = (input: ServiceInput) =>
    input.action === EServiceAction.List
  readonly inputSchema = serviceInputSchema
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
    activeWorktree,
  }: ToolRun<typeof serviceInputSchema>): Promise<ToolOutcome> {
    const place = placeOf({ projectDirectory, activeWorktree })
    const common = { ctx: this.ctx, state: this.state, input, signal }
    if (input.action === EServiceAction.Start) {
      return startService({ ...common, projectDirectory, place })
    }
    if (input.action === EServiceAction.Stop) {
      return stopServiceAction({ ...common, place })
    }
    if (input.action === EServiceAction.Restart) {
      return restartService({ ...common, place })
    }
    return listServiceRows({ ctx: this.ctx, input, projectDirectory, signal })
  }
}
