import { defineCommand, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const cancelResizeArgs = z.strictObject({})

export const cancelResize = defineCommand({
  spec: {
    name: 'cancel-resize',
    summary: 'Cancel a pod resize that waits for the pod to go idle',
    group: ECommandGroup.Session,
    args: cancelResizeArgs,
    runsIn: ECommandRunsIn.Control,
  },
})
