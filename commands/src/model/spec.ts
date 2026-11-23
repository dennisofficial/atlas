import { defineCommand, EClientAction, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const model = defineCommand({
  spec: {
    name: 'model',
    summary: 'Pick the model for this session',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.ModelPicker,
  },
})
