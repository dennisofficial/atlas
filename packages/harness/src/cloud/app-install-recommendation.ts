import type { TransportRetryLog } from './cloud-transport'
import type { AppInstallRecommendation, SubscriptionOutcome } from './pr-subscription-client'

export type AppInstallRecommended = (recommendation: AppInstallRecommendation) => void

export type AppInstallRaiser = (outcome: SubscriptionOutcome) => void

/** Raises each distinct install URL once: every resubscribe repeats the server's recommendation. */
export function createAppInstallRaiser(args: {
  onRecommended: AppInstallRecommended | undefined
  log: TransportRetryLog | undefined
}): AppInstallRaiser {
  const raised = new Set<string>()

  return (outcome) => {
    const recommendation = outcome.recommendAppInstall
    if (recommendation === undefined || args.onRecommended === undefined) return
    if (raised.has(recommendation.installUrl)) return
    raised.add(recommendation.installUrl)

    try {
      args.onRecommended(recommendation)
    } catch (failure) {
      args.log?.port.warn({
        source: 'cloud.pull-requests',
        message: `an app install recommendation consumer threw: ${failure instanceof Error ? failure.message : String(failure)}`,
      })
    }
  }
}
