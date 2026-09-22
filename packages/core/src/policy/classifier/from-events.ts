import { EMessageOrigin, saidBy } from '../../events/body'
import type { Event } from '../../events/envelope'
import type { CallId } from '../../events/ids'
import { eventsOfType } from '../../events/projections'
import type { EToolEffect } from '../../tools/tool'
import { EDeed, type Deed } from './deed'
import type { OperatorUtterance, RecentAct, TranscriptMessage } from './evidence'
import { ESpeaker } from './evidence'
import { placesOf } from './probes/kit'
import { looksDownloaded, looksSecretShaped } from './shapes'

export type ActReading = { effect: EToolEffect; deeds: readonly Deed[] }

export type ActLens = (args: { name: string; input: unknown }) => ActReading

export const TOOLS_THAT_INGEST_UNTRUSTED_CONTENT: ReadonlySet<string> = new Set([
  'web_fetch',
  'web_search',
])

const pathsOf = ({ deeds }: { deeds: readonly Deed[] }): readonly string[] =>
  deeds.flatMap((deed) => placesOf({ deed }))

function ingested({ name, deeds }: { name: string; deeds: readonly Deed[] }): boolean {
  if (TOOLS_THAT_INGEST_UNTRUSTED_CONTENT.has(name)) return true

  return deeds
    .filter((deed) => deed.action === EDeed.ReadOnly)
    .flatMap((deed) => placesOf({ deed }))
    .some((path) => looksDownloaded({ path }))
}

function settledCalls({ events }: { events: readonly Event[] }): ReadonlySet<CallId> {
  return new Set(eventsOfType({ events, type: 'tool-result' }).map((event) => event.callId))
}

export function recentActs({
  events,
  limit,
  lens,
}: {
  events: readonly Event[]
  limit: number
  lens: ActLens
}): readonly RecentAct[] {
  const settled = settledCalls({ events })

  return eventsOfType({ events, type: 'tool-called' })
    .filter((event) => settled.has(event.callId))
    .slice(-limit)
    .map((event) => {
      const read = lens({ name: event.name, input: event.input })

      return {
        name: event.name,
        effect: read.effect,
        deeds: read.deeds.map((deed) => deed.action),
        ingestedUntrustedContent: ingested({ name: event.name, deeds: read.deeds }),
        readSecretShapedPath: pathsOf({ deeds: read.deeds }).some((path) =>
          looksSecretShaped({ path }),
        ),
      }
    })
}

export function operatorUtterances({
  events,
  limit,
}: {
  events: readonly Event[]
  limit: number
}): readonly OperatorUtterance[] {
  return eventsOfType({ events, type: 'user-said' })
    .filter((event) => saidBy(event) === EMessageOrigin.Operator)
    .slice(-limit)
    .map((event) => ({ text: event.text, seq: event.seq }))
}

const clipped = ({ text, limit }: { text: string; limit: number }): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

export function transcriptMessages({
  events,
  limit,
  textLimit,
}: {
  events: readonly Event[]
  limit: number
  textLimit: number
}): readonly TranscriptMessage[] {
  const operator = eventsOfType({ events, type: 'user-said' })
    .filter((event) => saidBy(event) === EMessageOrigin.Operator)
    .map((event): TranscriptMessage => ({ speaker: ESpeaker.Operator, text: event.text, seq: event.seq }))

  const agent = eventsOfType({ events, type: 'assistant-said' })
    .map((event): TranscriptMessage => ({
      speaker: ESpeaker.Agent,
      text: event.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n'),
      seq: event.seq,
    }))
    .filter((message) => message.text.trim().length > 0)

  return [...operator, ...agent]
    .sort((one, other) => one.seq - other.seq)
    .slice(-limit)
    .map((message) => ({ ...message, text: clipped({ text: message.text, limit: textLimit }) }))
}
