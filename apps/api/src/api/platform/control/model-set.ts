import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

import { controlCommandHandlers } from './command-registry'

export const modelSetArgs = z.strictObject({
  model: z.string().min(1),
  effort: z.string().min(1).optional(),
  fast: z.boolean().optional(),
})

export const modelSet = defineCommand({
  spec: {
    name: 'model-set',
    summary: 'Run this session on another model, effort or fast mode',
    group: ECommandGroup.Session,
    args: modelSetArgs,
    timing: ECommandTiming.Immediate,
    handledIn: 'control',
  },
})

export const modelSetHandlers = (args: {
  plane: ControlPlane
  session: ControlSessionRow
}): ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>> => {
  const handler: ControlCommandHandler<ControlPlane, unknown> = async ({ args: raw }) => {
    const parsed = modelSetArgs.parse(raw)
    await args.plane.setSessionModel({
      sessionId: args.session.sessionId,
      ask: { ref: parsed.model, effort: parsed.effort, fast: parsed.fast },
    })
  }
  return new Map([...controlCommandHandlers(), [modelSet.spec.name, handler]])
}
