import { defineCommand, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const summariseArgs = z.strictObject({ throughSeq: z.number().int().min(1) })

export type SummariseArgs = z.infer<typeof summariseArgs>

export const summarise = defineCommand({
  spec: {
    name: 'summarise',
    summary: 'Replace everything before one of your messages with a summary',
    group: ECommandGroup.Context,
    args: summariseArgs,
    runsIn: ECommandRunsIn.Host,
  },
})
