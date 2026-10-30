import type { StepFailure } from '@dltech/atlas-client/transcript'
import { ERunFailureAction, runFailureCopy } from '@dltech/atlas-core'

export type FailureView = {
  title: string
  detail: string
  showSettings: boolean
}

export type AccountLabelOf = (accountId: string) => string | undefined

const LEGACY_TITLE = 'The run failed'
const LEGACY_DETAIL = 'The run failed.'

export function failureViewOf(args: {
  failure: StepFailure | null
  accountLabelOf?: AccountLabelOf | undefined
}): FailureView | null {
  const { failure } = args
  if (failure === null) return null
  if (failure.failure === null) {
    return {
      title: LEGACY_TITLE,
      detail: failure.message ?? LEGACY_DETAIL,
      showSettings: false,
    }
  }
  const { accountId } = failure.failure
  const copy = runFailureCopy({
    failure: failure.failure,
    accountLabel: accountId === undefined ? undefined : args.accountLabelOf?.(accountId),
  })
  return {
    title: copy.title,
    detail: copy.detail,
    showSettings: copy.action === ERunFailureAction.OpenProviderSettings,
  }
}
