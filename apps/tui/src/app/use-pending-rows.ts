import type { PendingInputsState } from '@dltech/atlas-core'
import { useMemo } from 'react'

import type { PendingRow } from '../store'
import { pendingRowsOf } from './pending-rows'
import type { StagedMessage } from './staged-messages'

export function usePendingRows(args: {
  pending: PendingInputsState
  staged: readonly StagedMessage[]
  refused: readonly StagedMessage[]
  working: boolean
  hiddenInboxIds: ReadonlySet<number>
}): readonly PendingRow[] {
  const { pending, staged, refused, working, hiddenInboxIds } = args
  return useMemo(
    () => pendingRowsOf({ pending, staged, refused, working, hiddenInboxIds }),
    [pending, staged, refused, working, hiddenInboxIds],
  )
}
