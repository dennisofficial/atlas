import { ESandboxStatus } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const AGENT37_STATUS_EVENT = 'instance.status.updated'

const statusEventSchema = z.object({
  type: z.string(),
  timestamp: z.string().min(1),
  data: z.object({
    id: z.string().min(1),
    status: z.nativeEnum(ESandboxStatus),
    status_reason: z.object({ message: z.string().optional() }).nullish(),
  }),
})

export type Agent37StatusEvent = {
  instanceId: string
  status: ESandboxStatus
  reason?: string | undefined
  at: string
}

export const agent37StatusEventOf = (payload: unknown): Agent37StatusEvent | null => {
  const parsed = statusEventSchema.safeParse(payload)
  if (!parsed.success) return null
  if (parsed.data.type !== AGENT37_STATUS_EVENT) return null
  if (Number.isNaN(Date.parse(parsed.data.timestamp))) return null
  const reason = parsed.data.data.status_reason?.message
  return {
    instanceId: parsed.data.data.id,
    status: parsed.data.data.status,
    ...(reason === undefined || reason.length === 0 ? {} : { reason }),
    at: new Date(parsed.data.timestamp).toISOString(),
  }
}
