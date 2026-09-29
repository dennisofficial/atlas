import { transcriptOfRange, type Event } from '@dltech/atlas-core'

import { namingTextOf } from './naming-text'

const OPENING_CHARACTER_LIMIT = 300
const RECENT_CHARACTER_LIMIT = 1500
const ELISION = '\n…\n'

/**
 * The first user-said's attached files re-join its line in the digest, the way the titler was
 * always meant to read them: the transcript renders prose alone, and an opener of "check out this
 * handoff" names nothing without the handoff's head beside it.
 */
const openerLine = (events: readonly Event[]): string | undefined => {
  const opener = events.find((event) => event.type === 'user-said')
  if (opener === undefined || opener.type !== 'user-said') return undefined

  const context = events.filter(
    (event) => event.runId === opener.runId && event.type === 'context-loaded',
  )

  return `Operator: ${namingTextOf({ said: opener.text, context })}`
}

/**
 * What a titler or summariser reads when it names a session from the transcript: the opening plus
 * the recent tail, with the middle elided. `proseOnly` keeps tool chatter out of a naming ask.
 */
export function sessionDigest(events: readonly Event[]): string {
  const last = events.at(-1)
  if (last === undefined) return ''

  const transcript = transcriptOfRange({ events, throughSeq: last.seq, proseOnly: true })
  const opening = openerLine(events)

  const digest =
    opening !== undefined && transcript.startsWith('Operator:')
      ? `${opening}${transcript.slice(transcript.indexOf('\n'))}`
      : transcript

  if (digest.length <= OPENING_CHARACTER_LIMIT + RECENT_CHARACTER_LIMIT) return digest

  const head = digest.slice(0, OPENING_CHARACTER_LIMIT)
  const recent = digest.slice(-RECENT_CHARACTER_LIMIT)
  return `${head}${ELISION}${recent}`
}
