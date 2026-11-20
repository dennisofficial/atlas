import { ENVELOPE_NOTICE_TAG } from '../../context/envelope'
import type { Event } from '../../events/envelope'
import type { AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

const NOTICE_PREFIX = `<${ENVELOPE_NOTICE_TAG}`

const firstTextOf = (entry: AssembledMessage): string | undefined => {
  if (entry.message.role !== 'user') return undefined
  const part = entry.message.content[0]
  return part?.type === 'text' ? part.text : undefined
}

const isNotice = (entry: AssembledMessage): boolean =>
  firstTextOf(entry)?.startsWith(NOTICE_PREFIX) === true

const trailingUserRunStart = (messages: readonly AssembledMessage[]): number => {
  let start = messages.length
  while (start > 0 && messages[start - 1]?.message.role === 'user') start -= 1
  return start
}

/** Only a notice jumps an informational notice: a setup line never buries the reply above it. */
export function informationalNoticesLast({
  messages,
  informational,
}: {
  messages: readonly AssembledMessage[]
  informational: (entry: AssembledMessage) => boolean
}): readonly AssembledMessage[] {
  const start = trailingUserRunStart(messages)
  if (messages.length - start < 2) return messages

  const ordered: AssembledMessage[] = []
  const deferred: AssembledMessage[] = []

  for (const entry of messages.slice(start)) {
    if (informational(entry)) {
      deferred.push(entry)
      continue
    }

    if (!isNotice(entry)) {
      ordered.push(...deferred)
      deferred.length = 0
    }

    ordered.push(entry)
  }

  return [...messages.slice(0, start), ...ordered, ...deferred]
}

const informationalEventIds = (events: readonly Event[]): ReadonlySet<string> =>
  new Set(
    events.flatMap((event) =>
      event.type === 'sandbox-setup-reported' && !event.failed ? [event.id] : [],
    ),
  )

export function noticeOrder(): Rule {
  return defineRule({
    name: 'noticeOrder',
    apply: (input, ctx) => {
      const informational = informationalEventIds(ctx.events)
      if (informational.size === 0) return input

      return {
        system: input.system,
        messages: informationalNoticesLast({
          messages: input.messages,
          informational: (entry) => informational.has(entry.origin.eventId),
        }),
      }
    },
  })
}
