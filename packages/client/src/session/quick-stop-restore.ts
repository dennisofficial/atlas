import {
  attachmentsOf,
  EMessageOrigin,
  ERewindCause,
  saidBy,
  type Attachment,
  type V2Event,
} from '@dltech/atlas-core'

export type QuickStopMessage = {
  clientId: string
  text: string
  attachments: readonly Attachment[]
}

export type QuickStopEvidence = {
  rewindEventId: string
  messages: readonly QuickStopMessage[]
}

export type QuickStopRestore = {
  rewindEventId: string
  text: string
  attachments: readonly Attachment[]
}

type SaidRow = Extract<V2Event, { type: 'user-said' }>

const EVIDENCE_TYPES: ReadonlySet<string> = new Set([
  'user-said',
  'input-posted',
  'history-rewound',
])

export const isQuickStopEvidenceRow = (event: V2Event): boolean => EVIDENCE_TYPES.has(event.type)

export const quickStopEvidenceRowsOf = (events: readonly V2Event[]): readonly V2Event[] =>
  events.filter(isQuickStopEvidenceRow)

const clientIdByInboxOf = (rows: readonly V2Event[]): ReadonlyMap<number, string> =>
  new Map(
    rows.flatMap((event) =>
      event.type === 'input-posted' && event.message?.clientId !== undefined
        ? [[event.inboxId, event.message.clientId] as const]
        : [],
    ),
  )

const uniqueAttachments = (attachments: readonly Attachment[]): readonly Attachment[] => {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.id)) return false
    seen.add(attachment.id)
    return true
  })
}

const hiddenMessageOf = (args: {
  row: V2Event
  rewind: Extract<V2Event, { type: 'history-rewound' }>
  byInbox: ReadonlyMap<number, string>
}): QuickStopMessage | undefined => {
  const { row, rewind, byInbox } = args
  if (row.type !== 'user-said') return undefined
  if (row.seq <= rewind.toSeq || row.seq >= rewind.seq) return undefined
  if (saidBy(row) !== EMessageOrigin.Operator) return undefined
  const clientId = row.clientId ?? byInbox.get(row.inboxId ?? 0)
  if (clientId === undefined) return undefined
  return { clientId, text: row.text, attachments: attachmentsOf(row as SaidRow) }
}

export const quickStopsOf = (rows: readonly V2Event[]): readonly QuickStopEvidence[] => {
  const byInbox = clientIdByInboxOf(rows)
  return rows.flatMap((rewind) => {
    if (rewind.type !== 'history-rewound') return []
    if (rewind.cause !== ERewindCause.QuickStop) return []
    const messages = rows.flatMap((row) => {
      const message = hiddenMessageOf({ row, rewind, byInbox })
      return message === undefined ? [] : [message]
    })
    if (messages.length === 0) return []
    return [{ rewindEventId: rewind.id, messages }]
  })
}

export const quickStopRestoresOf = (args: {
  quickStops: readonly QuickStopEvidence[]
  clientIds: readonly string[]
}): readonly QuickStopRestore[] => {
  const wanted = new Set(args.clientIds)
  if (wanted.size === 0) return []
  return args.quickStops.flatMap((evidence) => {
    const mine = evidence.messages.filter((message) => wanted.has(message.clientId))
    if (mine.length === 0) return []
    return [
      {
        rewindEventId: evidence.rewindEventId,
        text: mine.map((message) => message.text).join('\n\n'),
        attachments: uniqueAttachments(mine.flatMap((message) => message.attachments)),
      },
    ]
  })
}

export const quickStopRestoresToApply = (args: {
  quickStops: readonly QuickStopEvidence[]
  clientIds: readonly string[]
  handled: ReadonlySet<string>
}): readonly QuickStopRestore[] =>
  quickStopRestoresOf(args).filter((restore) => !args.handled.has(restore.rewindEventId))
