import { defineCommand, EClientAction, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const help = defineCommand({
  spec: {
    name: 'help',
    summary: 'List the commands',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.CommandList,
  },
})
