import { providerLabelOf } from '../credentials/providers'
import { ERunFailureKind, type RunFailure } from './run-failure'

export enum ERunFailureAction {
  OpenProviderSettings = 'open-provider-settings',
  Retry = 'retry',
}

export type RunFailureCopy = { title: string; detail: string; action: ERunFailureAction }

export { providerLabelOf }

const FALLBACK_PROVIDER = 'the provider'
const FALLBACK_ACCOUNT = 'this account'

export function runFailureCopy(args: {
  failure: RunFailure
  providerLabel?: string | undefined
  accountLabel?: string | undefined
}): RunFailureCopy {
  const { failure } = args
  const provider = args.providerLabel ?? providerLabelOf(failure.providerId) ?? FALLBACK_PROVIDER
  const account = args.accountLabel ?? FALLBACK_ACCOUNT
  const subject = provider === FALLBACK_PROVIDER ? 'The provider' : provider

  switch (failure.kind) {
    case ERunFailureKind.Auth:
      return {
        title: `${subject} rejected the API key`,
        detail: `${subject} rejected the API key for ${account}. Update it in Settings → Providers, then retry.`,
        action: ERunFailureAction.OpenProviderSettings,
      }
    case ERunFailureKind.Quota:
      return {
        title: `${account === FALLBACK_ACCOUNT ? subject : account} is out of credits`,
        detail: `${subject} reports no remaining credits or quota for ${account}. Top up in Settings → Providers or switch model, then retry.`,
        action: ERunFailureAction.OpenProviderSettings,
      }
    case ERunFailureKind.RateLimited:
      return {
        title: `${subject} rate limited the run`,
        detail: `${subject} is rate limiting requests for ${account}. Wait a moment and retry.`,
        action: ERunFailureAction.Retry,
      }
    case ERunFailureKind.Network:
      return {
        title: `Couldn't reach ${provider}`,
        detail: `The connection to ${provider} dropped before the run finished. Check your network, then retry.`,
        action: ERunFailureAction.Retry,
      }
    case ERunFailureKind.Overloaded:
      return {
        title: `${subject} is overloaded`,
        detail: `${subject} is overloaded right now. Retry in a moment or switch model.`,
        action: ERunFailureAction.Retry,
      }
    case ERunFailureKind.Other:
      return { title: 'The run failed', detail: failure.message, action: ERunFailureAction.Retry }
  }
}
