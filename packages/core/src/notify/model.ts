import { z } from 'zod'

import { ENotifyMoment } from './moment'

export type AtlasNotification = {
  sessionId: string
  seq: number
  moment: ENotifyMoment
  title: string
  body: string
  at: string
}

export const atlasNotificationSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  moment: z.enum(ENotifyMoment),
  title: z.string().min(1),
  body: z.string().min(1),
  at: z.string().min(1),
})
