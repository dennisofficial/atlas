import { defineCommand, EClientAction, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const shells = defineCommand({
  spec: {
    name: 'shells',
    summary: "the session's background shells",
    group: ECommandGroup.Workspace,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.Shells,
  },
})
