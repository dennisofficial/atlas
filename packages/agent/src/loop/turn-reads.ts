import type { Event, LoopState, ThreadId } from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'
import type { TrackedTurnDeps } from './tracked-turn-deps'
import { type CommittedCall, unsettledCall } from './swallowed-outcome'
import { committedSinceLastMessage } from './turn-position'

type Reader = Pick<AgentRecordPort, 'ownEvents' | 'loopState'>

export async function committedSinceLastPrompt({
  record,
  threadId,
}: {
  record: Reader
  threadId: ThreadId
}): Promise<boolean> {
  const state = await record.loopState({ threadId })
  return committedSinceLastMessage(
    await record.ownEvents({ threadId, afterSeq: state.lastUserSaidSeq }),
  )
}

export async function tailForLoopGuard({
  deps,
  threadId,
  state,
}: {
  deps: Pick<TrackedTurnDeps, 'record' | 'applyLoopCut'>
  threadId: ThreadId
  state: LoopState
}): Promise<readonly Event[]> {
  if (deps.applyLoopCut === undefined) return []
  return deps.record.ownEvents({ threadId, afterSeq: state.lastUserSaidSeq })
}

export async function eventsForLoopWatch({
  deps,
  threadId,
}: {
  deps: Pick<TrackedTurnDeps, 'record' | 'watchLoop'>
  threadId: ThreadId
}): Promise<readonly Event[]> {
  if (deps.watchLoop === undefined) return []
  return deps.record.ownEvents({ threadId })
}

export async function swallowedSince({
  record,
  threadId,
  turnStartSeq,
  committed,
}: {
  record: Reader
  threadId: ThreadId
  turnStartSeq: number
  committed: readonly CommittedCall[]
}): Promise<CommittedCall | undefined> {
  const owned = await record.ownEvents({ threadId, afterSeq: turnStartSeq })
  return unsettledCall({ committed, owned })
}
