import type { SessionChange } from '@dltech/atlas-protocol'

import type { AppendCommit, AppendOpening } from '../../port'
import { insertEventsIn } from './memory-events'
import type { State } from './memory-state'
import { readThreadIn, writeThreadHeadIn } from './memory-threads'
import { readSessionViewIn, writeSessionViewIn } from './memory-views'

export const openAppendIn = (params: {
  state: State
  threadId: string
}): AppendOpening | undefined => {
  const row = readThreadIn({ state: params.state, threadId: params.threadId })
  if (row === undefined) return undefined
  const session = params.state.sessions.get(row.sessionId)
  if (session === undefined) return undefined
  const lease = params.state.leases.get(row.sessionId)
  return {
    row,
    lease: lease === undefined ? undefined : { ...lease },
    mainThreadId: session.mainThreadId,
    view: readSessionViewIn({ state: params.state, sessionId: row.sessionId }),
  }
}

export const commitAppendIn = (
  params: { state: State; pending: SessionChange[] } & AppendCommit,
): boolean => {
  insertEventsIn({ state: params.state, rows: params.events })
  const swapped = writeThreadHeadIn({ state: params.state, ...params.head })
  if (!swapped) return false
  if (params.view !== undefined) writeSessionViewIn({ state: params.state, row: params.view })
  params.pending.push({ ...params.change })
  return true
}
