import { z } from 'zod'

import { EOomScope } from '@dltech/atlas-core'

import { okResultSchema } from './result'

export const OOM_JOURNAL_LIMIT = 50

export const oomMemorySchema = z
  .object({
    commandLimitBytes: z.number().int().min(0),
    podBytes: z.number().int().min(0),
  })
  .strict()

export const oomIncidentSchema = z
  .object({
    incidentId: z.string().min(1),
    at: z.number().int().min(0),
    scope: z.enum(EOomScope),
    command: z.string().min(1).optional(),
    processes: z.number().int().min(1),
    memory: oomMemorySchema,
  })
  .strict()

export const oomListOpSchema = z.object({ op: z.literal('oom.list') }).strict()

export const oomListResultSchema = z
  .object({ incidents: z.array(oomIncidentSchema).max(OOM_JOURNAL_LIMIT) })
  .strict()

export const oomOpSchemas = [oomListOpSchema] as const

export const oomResultSchemas = [
  okResultSchema({ op: 'oom.list', value: oomListResultSchema }),
] as const

export const podOomEventSchema = z
  .object({ type: z.literal('pod.oom'), incident: oomIncidentSchema })
  .strict()

export const oomEventSchemas = [podOomEventSchema] as const

export type OomIncident = z.infer<typeof oomIncidentSchema>
export type OomListResult = z.infer<typeof oomListResultSchema>
export type PodOomEvent = z.infer<typeof podOomEventSchema>
