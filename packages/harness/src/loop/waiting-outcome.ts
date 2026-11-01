import type { RunId, ThreadId } from '@dltech/atlas-core'

import { waitingOfBlock } from '../model-recovery/waiting-of-block'
import type { SteppedTurn } from './model-step'
import type { TrackedTurnDeps } from './tracked-turn-deps'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'

export async function waitingIfBlocked({
  deps,
  stepped,
  threadId,
  runId,
}: {
  deps: Pick<TrackedTurnDeps, 'waitState'>
  stepped: SteppedTurn
  threadId: ThreadId
  runId: RunId
}): Promise<TurnOutcome | undefined> {
  if (stepped.ok || stepped.blocked === undefined) return undefined
  const waiting = waitingOfBlock({ error: stepped.blocked, threadId })
  await deps.waitState?.observe({ threadId, waiting })
  return { status: ETurnStatus.WaitingForModel, runId, waiting }
}
