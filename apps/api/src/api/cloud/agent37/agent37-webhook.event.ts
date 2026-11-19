import { ESandboxStatus } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const AGENT37_STATUS_EVENT = 'instance.status.updated'

const statusEventSchema = z.object({
  type: z.string(),
  timestamp: z.string().min(1),
  data: z.object({
    id: z.string().min(1),
    status: z.nativeEnum(ESandboxStatus),
  }),
})

export type Agent37StatusEvent = {
  instanceId: string
  status: ESandboxStatus
  at: string
}

export const agent37StatusEventOf = (payload: unknown): Agent37StatusEvent | null => {
  const parsed = statusEventSchema.safeParse(payload)
  if (!parsed.success) return null
  if (parsed.data.type !== AGENT37_STATUS_EVENT) return null
  if (Number.isNaN(Date.parse(parsed.data.timestamp))) return null
  return {
    instanceId: parsed.data.data.id,
    status: parsed.data.data.status,
    at: new Date(parsed.data.timestamp).toISOString(),
  }
}
