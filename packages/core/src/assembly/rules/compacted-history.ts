import { keptThroughCompaction } from '../../compaction/disposition'
import { compactionWatermarks, type CompactionWatermark } from '../../compaction/watermark'
import { systemContext } from '../../context/envelope'
import type { Event } from '../../events/envelope'
import type { AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

const COMPACTION_PREFACE = 'Earlier turns of this conversation, compacted to save context:'

const compactionBlock = (summary: string): string =>
  systemContext({
    slot: 'compaction',
    key: 'summary',
    content: `${COMPACTION_PREFACE}\n\n${summary}`,
  })

const summaryMessage = (watermark: CompactionWatermark): AssembledMessage => ({
  message: { role: 'user', content: [{ type: 'text', text: compactionBlock(watermark.summary) }] },
  origin: { eventId: watermark.id, seq: watermark.throughSeq },
})

const outlivesCompaction = (events: readonly Event[]): ReadonlySet<number> =>
  new Set(events.flatMap((event) => (keptThroughCompaction(event.type) ? [event.seq] : [])))

const covered = (args: { watermark: CompactionWatermark; seq: number }): boolean =>
  args.seq >= args.watermark.fromSeq &&
  args.seq <= args.watermark.throughSeq &&
  args.seq !== args.watermark.seq

const callsTools = (entry: AssembledMessage | undefined): boolean =>
  entry?.message.role === 'assistant' &&
  entry.message.content.some((part) => part.type === 'tool-call')

function keptOutside({
  messages,
  watermark,
  spared,
}: {
  messages: readonly AssembledMessage[]
  watermark: CompactionWatermark
  spared: ReadonlySet<number>
}): AssembledMessage[] {
  const kept: AssembledMessage[] = []
  let callerDropped: boolean | undefined

  for (const entry of messages) {
    const own = spared.has(entry.origin.seq) || !covered({ watermark, seq: entry.origin.seq })
    const keep = entry.message.role === 'tool' && callerDropped !== undefined ? !callerDropped : own
    callerDropped = callsTools(entry)
      ? !keep
      : entry.message.role === 'tool'
        ? callerDropped
        : undefined
    if (keep) kept.push(entry)
  }

  return kept
}

function spliced({
  messages,
  summary,
  throughSeq,
}: {
  messages: readonly AssembledMessage[]
  summary: AssembledMessage
  throughSeq: number
}): readonly AssembledMessage[] {
  let at = messages.findIndex((entry) => entry.origin.seq > throughSeq)
  if (at === -1) return [...messages, summary]
  while (messages[at]?.message.role === 'tool' && callsTools(messages[at - 1])) at += 1
  return [...messages.slice(0, at), summary, ...messages.slice(at)]
}

export function compactedHistory(): Rule {
  return defineRule({
    name: 'compactedHistory',
    apply: (input, ctx) => {
      const watermarks = compactionWatermarks(ctx.events)
      if (watermarks.length === 0) return input

      const spared = outlivesCompaction(ctx.events)

      return watermarks.reduce(
        (assembled, watermark) => ({
          system: assembled.system,
          messages: spliced({
            messages: keptOutside({ messages: assembled.messages, watermark, spared }),
            summary: summaryMessage(watermark),
            throughSeq: watermark.throughSeq,
          }),
        }),
        input,
      )
    },
  })
}
