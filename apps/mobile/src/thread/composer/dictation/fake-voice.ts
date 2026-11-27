import { clampLevel } from './level-smoothing'
import { type ITranscript, joinWords } from './transcript-model'

export const DICTATION_SCRIPT_WORDS: readonly string[] = [
  'Open',
  'a',
  'PR',
  'that',
  'moves',
  'the',
  'tRPC',
  'router',
  'into',
  'packages/api-router,',
  'then',
  'run',
  'bun',
  'test',
  'in',
  'apps/mobile',
  'and',
  'check',
  'the',
  'Reanimated',
  '4',
  'layout',
  'transitions.',
]

export const WORD_MS = 190

export const COMMIT_EVERY = 4

const LEAD_IN_MS = 220

const SYLLABLE_MS = 168

const PHRASE_MS = 3100

const PHRASE_PAUSE_MS = 620

export interface IVoiceWord {
  word: string
  startMs: number
}

export const voiceTimelineOf = ({
  words = DICTATION_SCRIPT_WORDS,
  wordMs = WORD_MS,
}: {
  words?: readonly string[]
  wordMs?: number
} = {}): readonly IVoiceWord[] =>
  words.map((word, index) => ({
    word,
    startMs: LEAD_IN_MS + Math.round(index * wordMs + (index % 3) * 45 + (index % 5) * 25),
  }))

export const voiceDurationOf = (timeline: readonly IVoiceWord[]): number => {
  const last = timeline.at(-1)
  return last === undefined ? 0 : last.startMs + 900
}

const arrivedCountOf = ({
  timeline,
  elapsedMs,
}: {
  timeline: readonly IVoiceWord[]
  elapsedMs: number
}): number => {
  let arrived = 0
  for (const entry of timeline) {
    if (entry.startMs > elapsedMs) break
    arrived += 1
  }
  return arrived
}

export const transcriptAtOf = ({
  timeline,
  elapsedMs,
  commitEvery = COMMIT_EVERY,
}: {
  timeline: readonly IVoiceWord[]
  elapsedMs: number
  commitEvery?: number
}): ITranscript => {
  const arrived = arrivedCountOf({ timeline, elapsedMs })
  const finalized = arrived === timeline.length ? arrived : arrived - (arrived % commitEvery)
  const committed = timeline
    .slice(0, finalized)
    .reduce((head, entry) => joinWords({ head, word: entry.word }), '')
  const interim = timeline
    .slice(finalized, arrived)
    .reduce((head, entry) => joinWords({ head, word: entry.word }), '')
  return { committed, interim }
}

export const speechLevelOf = ({ elapsedMs }: { elapsedMs: number }): number => {
  if (elapsedMs < 0) return 0
  const inPause = elapsedMs % PHRASE_MS > PHRASE_MS - PHRASE_PAUSE_MS
  if (inPause) return 0
  const syllable = Math.sin(((elapsedMs % SYLLABLE_MS) / SYLLABLE_MS) * Math.PI) ** 2
  const swell = 0.58 + 0.42 * Math.abs(Math.sin(elapsedMs / 870))
  return clampLevel(syllable * swell)
}
