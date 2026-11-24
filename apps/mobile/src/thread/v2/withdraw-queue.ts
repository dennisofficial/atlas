import { ALREADY_SENT_REASON } from '@dltech/atlas-client/stream'
import type { Attachment, V2Event } from '@dltech/atlas-core'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'

export const ALREADY_SENT_NOTICE = 'Already sent'

export const WITHDRAW_UNKNOWN_NOTICE = 'That message is no longer queued'

export type WithdrawRequest = {
  targetInboxId: number
  restoreText: boolean
  text: string
  attachments: readonly Attachment[]
}

export type WithdrawRestore = { text: string; attachments: readonly Attachment[] }

export type WithdrawStep = {
  handled: ReadonlySet<number>
  restore: WithdrawRestore | undefined
  notices: readonly string[]
}

export const withdrawRefusalNoticeOf = (reason: string): string =>
  reason === ALREADY_SENT_REASON || reason === EWithdrawRefusal.AlreadyConsumed
    ? ALREADY_SENT_NOTICE
    : WITHDRAW_UNKNOWN_NOTICE

const withdrawnOf = (args: { request: WithdrawRequest; events: readonly V2Event[] }): boolean =>
  args.events.some(
    (event) => event.type === 'input-withdrawn' && event.inboxId === args.request.targetInboxId,
  )

const refusedOf = (args: {
  request: WithdrawRequest
  events: readonly V2Event[]
}): string | undefined => {
  for (const event of args.events) {
    if (event.type !== 'input-refused') continue
    if (event.targetInboxId !== args.request.targetInboxId) continue
    return event.reason
  }
  return undefined
}

export const withdrawStepOf = (args: {
  requests: readonly WithdrawRequest[]
  handled: ReadonlySet<number>
  events: readonly V2Event[]
}): WithdrawStep => {
  const settled: number[] = []
  const restores: WithdrawRestore[] = []
  const notices: string[] = []
  for (const request of args.requests) {
    if (args.handled.has(request.targetInboxId)) continue
    if (withdrawnOf({ request, events: args.events })) {
      settled.push(request.targetInboxId)
      if (request.restoreText)
        restores.push({ text: request.text, attachments: request.attachments })
      continue
    }
    const reason = refusedOf({ request, events: args.events })
    if (reason === undefined) continue
    settled.push(request.targetInboxId)
    notices.push(withdrawRefusalNoticeOf(reason))
  }
  if (settled.length === 0) return { handled: args.handled, restore: undefined, notices: [] }
  return {
    handled: new Set([...args.handled, ...settled]),
    restore:
      restores.length === 0
        ? undefined
        : {
            text: restores.map((entry) => entry.text).join('\n\n'),
            attachments: restores.flatMap((entry) => [...entry.attachments]),
          },
    notices,
  }
}
