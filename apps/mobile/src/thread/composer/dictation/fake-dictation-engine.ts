import {
  EDictationEvent,
  type IDictationEngine,
  type IDictationSession,
  type TDictationEvent,
} from './dictation-engine'
import { type IDictationStep, startScriptOf } from './dictation-script'
import {
  COMMIT_EVERY,
  type IVoiceWord,
  speechLevelOf,
  voiceDurationOf,
  voiceTimelineOf,
} from './fake-voice'
import { joinWords } from './transcript-model'

export const LEVEL_STEP_MS = 60

const wordsOf = ({
  timeline,
  from,
  to,
}: {
  timeline: readonly IVoiceWord[]
  from: number
  to: number
}) => timeline.slice(from, to).reduce((head, entry) => joinWords({ head, word: entry.word }), '')

export const fakeTranscriptStepsOf = ({
  timeline = voiceTimelineOf(),
  commitEvery = COMMIT_EVERY,
}: {
  timeline?: readonly IVoiceWord[]
  commitEvery?: number
} = {}): readonly IDictationStep[] => {
  const steps: IDictationStep[] = []
  let commitFrom = 0
  timeline.forEach((entry, index) => {
    const last = index === timeline.length - 1
    const finalized = last || (index + 1) % commitEvery === 0
    const text = wordsOf({ timeline, from: commitFrom, to: index + 1 })
    steps.push({
      atMs: entry.startMs,
      event: finalized
        ? { type: EDictationEvent.Final, text }
        : { type: EDictationEvent.Partial, text },
    })
    if (finalized) commitFrom = index + 1
  })
  return steps
}

export const fakeLevelStepsOf = ({
  timeline = voiceTimelineOf(),
  levelStepMs = LEVEL_STEP_MS,
}: {
  timeline?: readonly IVoiceWord[]
  levelStepMs?: number
} = {}): readonly IDictationStep[] => {
  const duration = voiceDurationOf(timeline)
  const steps: IDictationStep[] = []
  for (let atMs = 0; atMs <= duration; atMs += levelStepMs) {
    steps.push({
      atMs,
      event: { type: EDictationEvent.Level, level: speechLevelOf({ elapsedMs: atMs }) },
    })
  }
  return steps
}

export const fakeStepsOf = ({
  timeline = voiceTimelineOf(),
  commitEvery = COMMIT_EVERY,
  levelStepMs = LEVEL_STEP_MS,
}: {
  timeline?: readonly IVoiceWord[]
  commitEvery?: number
  levelStepMs?: number
} = {}): readonly IDictationStep[] => {
  const duration = voiceDurationOf(timeline)
  const steps: IDictationStep[] = [
    ...fakeLevelStepsOf({ timeline, levelStepMs }),
    ...fakeTranscriptStepsOf({ timeline, commitEvery }),
    { atMs: duration, event: { type: EDictationEvent.Ended } },
  ]
  return steps.sort((left, right) => left.atMs - right.atMs)
}

export class FakeDictationEngine implements IDictationEngine {
  private readonly steps: readonly IDictationStep[]

  constructor({
    timeline = voiceTimelineOf(),
    commitEvery = COMMIT_EVERY,
    levelStepMs = LEVEL_STEP_MS,
  }: {
    timeline?: readonly IVoiceWord[]
    commitEvery?: number
    levelStepMs?: number
  } = {}) {
    this.steps = fakeStepsOf({ timeline, commitEvery, levelStepMs })
  }

  async start({
    onEvent,
  }: {
    onEvent: (event: TDictationEvent) => void
  }): Promise<IDictationSession> {
    return startScriptOf({ steps: this.steps, onEvent })
  }
}
