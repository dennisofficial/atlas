import { z } from 'zod'

import { EPodDiskPressure } from '@dltech/atlas-core'

export const podDiskPressureEventSchema = z
  .object({
    type: z.literal('pod.disk-pressure'),
    usedBytes: z.number().int().min(0),
    limitBytes: z.number().int().min(0),
    pressure: z.enum(EPodDiskPressure),
  })
  .strict()

export const diskEventSchemas = [podDiskPressureEventSchema] as const

export type PodDiskPressureEvent = z.infer<typeof podDiskPressureEventSchema>
