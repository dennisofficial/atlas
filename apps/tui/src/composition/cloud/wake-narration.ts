import { EExecutionLocation } from '@dltech/atlas-core'
import type { PodWakeNarration } from '@dltech/atlas-harness'
import type { SettleWaitNotice } from '@dltech/atlas-wire'

import type { BootNarration } from '../boot-block-store'
import { WAKE_HEADING } from '../container-move'

export const ROTATE_HEADING = 'Updating the pod'

const WAKE_ROWS = [
  { id: 'waiting', text: 'waiting for the pod', nodeIds: ['waiting'] },
  { id: 'attaching', text: 'attaching and verifying the conversation', nodeIds: ['attaching'] },
] as const

const settleWaitTextOf = (notice: SettleWaitNotice): string =>
  `waiting for Vercel to release the pod name (attempt ${notice.attempt}/${notice.attempts})`

export const podWakeNarrationOf = (move: BootNarration): PodWakeNarration => ({
  begin: () =>
    move.handleBegin({ target: EExecutionLocation.Cloud, rows: WAKE_ROWS, heading: WAKE_HEADING }),
  rotating: () =>
    move.handleExpand({
      insertBefore: 'attaching',
      row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
      heading: ROTATE_HEADING,
    }),
  settleWait: (notice) =>
    move.handleRowLabel({ nodeId: 'waiting', text: settleWaitTextOf(notice) }),
  attaching: () => move.handleRowActive('attaching'),
  settled: () => move.handleSettle(),
  failed: (reason) => move.handleFail(reason),
})

export const podWakeNarrationFor = (
  move: BootNarration | undefined,
): PodWakeNarration | undefined => (move === undefined ? undefined : podWakeNarrationOf(move))
