import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

import { controlCommandHandlers } from './command-registry'
import type { SessionModelChoice } from './session-model-choice'

export const modelSetArgs = z.strictObject({
  model: z.string().min(1),
  effort: z.string().min(1).optional(),
  fast: z.boolean().optional(),
  accountId: z.string().min(1).optional(),
})

export const modelSet = defineCommand({
  spec: {
    name: 'model-set',
    summary: 'Run this session on another model, effort or account',
    group: ECommandGroup.Session,
    args: modelSetArgs,
    timing: ECommandTiming.Immediate,
    handledIn: 'control',
  },
})

export const modelSetHandlers = (args: {
  choice: SessionModelChoice
  session: ControlSessionRow
}): ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>> => {
  const handler: ControlCommandHandler<ControlPlane, unknown> = async ({ args: raw }) => {
    const model = await args.choice.resolve({
      userId: args.session.userId,
      projectId: args.session.projectId,
      ...modelSetArgs.parse(raw),
    })
    if (model.modelRef === undefined) throw new Error('model-set resolved no model')
    await args.choice.write({
      sessionId: args.session.sessionId,
      ...model,
      modelRef: model.modelRef,
    })
  }
  return new Map([...controlCommandHandlers(), [modelSet.spec.name, handler]])
}
