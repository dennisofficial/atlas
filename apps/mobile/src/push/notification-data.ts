import { NOTIFY_DATA_SEQ_KEY, NOTIFY_DATA_SESSION_KEY } from '@dltech/atlas-notifications'
import { z } from 'zod'

const sessionIdSchema = z.object({ [NOTIFY_DATA_SESSION_KEY]: z.string().min(1) })

const presentedSchema = z.object({
  [NOTIFY_DATA_SESSION_KEY]: z.string().min(1),
  [NOTIFY_DATA_SEQ_KEY]: z.number().int().nonnegative(),
})

export type PresentedNotification = { identifier: string; sessionId: string; seq: number }

export const sessionIdOfData = (data: unknown): string | undefined => {
  const parsed = sessionIdSchema.safeParse(data)
  return parsed.success ? parsed.data[NOTIFY_DATA_SESSION_KEY] : undefined
}

export const presentedNotificationOf = (args: {
  identifier: string
  data: unknown
}): PresentedNotification | null => {
  const parsed = presentedSchema.safeParse(args.data)
  if (!parsed.success) return null
  return {
    identifier: args.identifier,
    sessionId: parsed.data[NOTIFY_DATA_SESSION_KEY],
    seq: parsed.data[NOTIFY_DATA_SEQ_KEY],
  }
}

export const readDismissalIdsOf = (args: {
  presented: readonly PresentedNotification[]
  readSeqs: ReadonlyMap<string, number>
}): string[] =>
  args.presented.flatMap((entry) => {
    const readSeq = args.readSeqs.get(entry.sessionId)
    return readSeq !== undefined && readSeq >= entry.seq ? [entry.identifier] : []
  })
