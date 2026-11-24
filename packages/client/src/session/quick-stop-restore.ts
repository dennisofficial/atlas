import {
  attachmentsOf,
  EMessageOrigin,
  ERewindCause,
  saidBy,
  type Attachment,
  type V2Event,
} from '@dltech/atlas-core'

export type QuickStopRestore = {
  rewindEventId: string
  text: string
  attachments: readonly Attachment[]
}

type SaidRow = Extract<V2Event, { type: 'user-said' }>

const clientIdByInbox = (events: readonly V2Event[]): ReadonlyMap<number, string> =>
  new Map(
    events.flatMap((event) =>
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

export const quickStopRestoresOf = (args: {
  events: readonly V2Event[]
  clientIds: readonly string[]
}): readonly QuickStopRestore[] => {
  const wanted = new Set(args.clientIds)
  if (wanted.size === 0) return []
  const byInbox = clientIdByInbox(args.events)
  return args.events.flatMap((event) => {
    if (event.type !== 'history-rewound' || event.cause !== ERewindCause.QuickStop) return []
    const hid = args.events.filter(
      (row): row is SaidRow =>
        row.seq > event.toSeq &&
        row.seq < event.seq &&
        row.type === 'user-said' &&
        saidBy(row) === EMessageOrigin.Operator &&
        wanted.has(row.clientId ?? byInbox.get(row.inboxId ?? 0) ?? ''),
    )
    if (hid.length === 0) return []
    return [
      {
        rewindEventId: event.id,
        text: hid.map((row) => row.text).join('\n\n'),
        attachments: uniqueAttachments(hid.flatMap((row) => attachmentsOf(row))),
      },
    ]
  })
}

export const quickStopRestoresToApply = (args: {
  events: readonly V2Event[]
  clientIds: readonly string[]
  handled: ReadonlySet<string>
}): readonly QuickStopRestore[] =>
  quickStopRestoresOf(args).filter((restore) => !args.handled.has(restore.rewindEventId))
