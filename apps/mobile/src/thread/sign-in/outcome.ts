import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'

import type { SignInRow } from '../row-types'

export const signInDurableOutcomeOf = (
  row: Pick<SignInRow, 'result' | 'reason'>,
): ReturnOutcome | undefined => {
  if (row.result === undefined) return undefined
  if (row.result === 'connected') return { result: EReturnResult.Connected }
  return row.reason === undefined
    ? { result: EReturnResult.Failed }
    : { result: EReturnResult.Failed, reason: row.reason }
}
