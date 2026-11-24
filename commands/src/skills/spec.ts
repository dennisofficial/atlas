import { defineCommand, EClientAction, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const skills = defineCommand({
  spec: {
    name: 'skills',
    summary: 'list the skills this session can run',
    group: ECommandGroup.Workspace,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.Skills,
  },
})
