import { notificationCopyOf } from './copy'
import type { AtlasNotification } from './model'
import type { ENotifyMoment } from './moment'

export const inAppNoticeOf = (args: {
  moment: ENotifyMoment
  sessionId: string
  sessionTitle: string | null
  seq: number
  readSeq: number | null
  onScreen: boolean
  focused: boolean
  enabled: boolean
  now: string
}): AtlasNotification | null => {
  if (!args.enabled) return null
  if (!args.focused) return null
  if (args.onScreen) return null
  if (args.readSeq !== null && args.readSeq >= args.seq) return null
  return {
    sessionId: args.sessionId,
    seq: args.seq,
    moment: args.moment,
    ...notificationCopyOf({ moment: args.moment, sessionTitle: args.sessionTitle }),
    at: args.now,
  }
}
