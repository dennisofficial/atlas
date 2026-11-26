import { backgroundWaitLabel, liveBackgroundOf, waitStartedAt } from '@dltech/atlas-client/crew'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'
import { formatElapsed } from '@dltech/atlas-client/transcript'
import type { RecordEvent } from '@dltech/atlas-core'

export type BackgroundWait = {
  label: string
  settledAt: string | undefined
}

const lastSettledAtOf = (events: readonly RecordEvent[]): string | undefined =>
  events.findLast((event) => event.type === 'turn-ended' && event.depth === 0)?.at

export const backgroundWaitOf = (args: {
  snapshot: Pick<SessionSnapshot, 'foldable' | 'connection'>
  turnRunning: boolean
}): BackgroundWait | null => {
  if (args.turnRunning) return null
  const work = liveBackgroundOf({
    events: args.snapshot.foldable,
    live: args.snapshot.connection === ESessionConnection.Live,
  })
  const label = backgroundWaitLabel({ work })
  if (label === null) return null
  return { label, settledAt: lastSettledAtOf(args.snapshot.foldable) }
}

export const waitElapsedOf = (args: {
  wait: BackgroundWait
  held: number | null
  now: number
}): string | undefined => {
  const since = waitStartedAt({ settledAt: args.wait.settledAt, held: args.held })
  return since === null ? undefined : formatElapsed(Math.max(0, args.now - since))
}
