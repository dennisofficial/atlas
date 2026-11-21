import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming, sandboxVcpusSchema } from '@dltech/atlas-core'
import { z } from 'zod'

export const resizeArgs = z.strictObject({
  vcpus: sandboxVcpusSchema,
  memoryGb: z.number().int().min(1),
  whenIdle: z.boolean().optional(),
})

export type ResizeArgs = z.infer<typeof resizeArgs>

export const resize = defineCommand({
  spec: {
    name: 'resize',
    summary: 'Resize this pod and restart its sandbox at the new size, or wait until it is idle',
    group: ECommandGroup.Session,
    args: resizeArgs,
    timing: ECommandTiming.Immediate,
    handledIn: 'control',
  },
})
