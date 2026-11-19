import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming, sandboxVcpusSchema } from '@dltech/atlas-core'
import { z } from 'zod'

export const resizeArgs = z.strictObject({ vcpus: sandboxVcpusSchema })

export type ResizeArgs = z.infer<typeof resizeArgs>

export const resize = defineCommand({
  spec: {
    name: 'resize',
    summary: 'Resize this pod and restart its sandbox at the new size',
    group: ECommandGroup.Session,
    args: resizeArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})
