import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming, sandboxVcpusSchema } from '@dltech/atlas-core'
import { z } from 'zod'

// https://www.agent37.com/docs/agents-api/instance-sizing.md — an Agent37 VM disk tops out at 100 GB
export const RESIZE_MAX_DISK_GB = 100

export const resizeArgs = z.strictObject({
  vcpus: sandboxVcpusSchema,
  memoryGb: z.number().int().min(1),
  diskGb: z.number().int().min(1).max(RESIZE_MAX_DISK_GB).optional(),
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
