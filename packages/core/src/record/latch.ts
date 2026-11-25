import type { RecordBody, RecordEvent } from './event'

type LatchFact = Extract<RecordBody, { type: 'fact-recorded' }>

export type LatchStep = { fire: boolean; record: number | undefined }

const LATCH_KIND = 'latch'

export const latchKeyOf = (name: string): string => `${LATCH_KIND}:${name}`

export const firedLatchLevelOf = (args: {
  events: readonly RecordEvent[]
  name: string
}): number => {
  const key = latchKeyOf(args.name)
  for (let index = args.events.length - 1; index >= 0; index -= 1) {
    const event = args.events[index]
    if (event?.type !== 'fact-recorded' || event.key !== key) continue
    return typeof event.value === 'number' ? event.value : 0
  }
  return 0
}

export const latchStepOf = (args: {
  fired: number
  level: number
  mayFire: boolean
}): LatchStep => {
  if (args.level <= 0) return { fire: false, record: args.fired === 0 ? undefined : 0 }
  if (!args.mayFire || args.level <= args.fired) return { fire: false, record: undefined }
  return { fire: true, record: args.level }
}

export const latchFactOf = (args: { name: string; level: number }): LatchFact => ({
  type: 'fact-recorded',
  key: latchKeyOf(args.name),
  kind: LATCH_KIND,
  value: args.level,
})
