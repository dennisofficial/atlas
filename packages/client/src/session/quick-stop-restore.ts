import type { Attachment } from '@dltech/atlas-core'

import type { QuickStopEvidence, QuickStopMessage } from './quick-stop-state'

export { quickStopsOf } from './quick-stop-state'
export type {
  QuickStopCandidate,
  QuickStopEvidence,
  QuickStopInbox,
  QuickStopMessage,
  QuickStopState,
} from './quick-stop-state'

export type QuickStopRestore = {
  rewindEventId: string
  text: string
  attachments: readonly Attachment[]
}

const uniqueAttachments = (attachments: readonly Attachment[]): readonly Attachment[] => {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.id)) return false
    seen.add(attachment.id)
    return true
  })
}

const messagesOf = (evidence: QuickStopEvidence, wanted: ReadonlySet<string>): QuickStopMessage[] =>
  evidence.messages.filter((message) => wanted.has(message.clientId))

export const quickStopRestoresOf = (args: {
  quickStops: readonly QuickStopEvidence[]
  clientIds: readonly string[]
}): readonly QuickStopRestore[] => {
  const wanted = new Set(args.clientIds)
  if (wanted.size === 0) return []
  return args.quickStops.flatMap((evidence) => {
    const mine = messagesOf(evidence, wanted)
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
