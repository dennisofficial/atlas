import { providerLabelOf, runFailureCopy, type ERunFailureAction } from '@dltech/atlas-core'

import type { StepFailure } from '../../../store'

const FAILURE_WITHOUT_A_REASON = 'The model reported no reason.'

export const failureText = (args: {
  failure: StepFailure
  accountLabel: string | undefined
}): { message: string; title?: string; action?: ERunFailureAction } => {
  const { failure, accountLabel } = args
  if (failure.failure === null) return { message: failure.message ?? FAILURE_WITHOUT_A_REASON }
  const copy = runFailureCopy({
    failure: failure.failure,
    providerLabel: providerLabelOf(failure.failure.providerId),
    accountLabel,
  })
  return { message: copy.detail, title: copy.title, action: copy.action }
}
