import { transcriptOfRange, type Event } from '@dltech/atlas-core'

const OPENING_CHARACTER_LIMIT = 300
const RECENT_CHARACTER_LIMIT = 1500
const ELISION = '\n…\n'

/**
 * What a titler or summariser reads when it names a session from the transcript: the opening plus
 * the recent tail, with the middle elided. `proseOnly` keeps tool chatter out of a naming ask.
 */
export function sessionDigest(events: readonly Event[]): string {
  const last = events.at(-1)
  if (last === undefined) return ''

  const transcript = transcriptOfRange({ events, throughSeq: last.seq, proseOnly: true })
  if (transcript.length <= OPENING_CHARACTER_LIMIT + RECENT_CHARACTER_LIMIT) return transcript

  const opening = transcript.slice(0, OPENING_CHARACTER_LIMIT)
  const recent = transcript.slice(-RECENT_CHARACTER_LIMIT)
  return `${opening}${ELISION}${recent}`
}
