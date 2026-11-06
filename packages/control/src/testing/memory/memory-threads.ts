import { GENESIS_HASH } from '@dltech/atlas-core'

import type { ThreadRow } from '../../port'
import type { State } from './memory-state'

export const createThreadIn = (params: {
  state: State
  threadId: string
  sessionId: string
  visibility: string
}): void => {
  const { state } = params
  if (state.threads.has(params.threadId)) throw new Error('thread exists')
  if (!state.sessions.has(params.sessionId)) throw new Error('unknown session')
  state.threads.set(params.threadId, {
    threadId: params.threadId,
    sessionId: params.sessionId,
    headSeq: 0,
    headHash: GENESIS_HASH,
    visibility: params.visibility,
  })
  state.events.set(params.threadId, [])
}

export const readThreadIn = (params: { state: State; threadId: string }): ThreadRow | undefined => {
  const row = params.state.threads.get(params.threadId)
  return row === undefined ? undefined : { ...row }
}

export const writeThreadHeadIn = (params: {
  state: State
  threadId: string
  expectedHeadSeq: number
  headSeq: number
  headHash: ThreadRow['headHash']
  visibility: string
}): boolean => {
  const row = params.state.threads.get(params.threadId)
  if (row === undefined || row.headSeq !== params.expectedHeadSeq) return false
  row.headSeq = params.headSeq
  row.headHash = params.headHash
  row.visibility = params.visibility
  return true
}
