import type { JsonValue, SubscribedTarget } from '@dltech/atlas-core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

export type PodSubscriptionLease = {
  repo: string
  subject: { kind: 'pull-request'; number: number } | { kind: 'workflow-run'; selector: string }
}

export type PodSubscribeArgs = {
  provider: string
  target: JsonValue
  label: string
  events?: readonly string[] | undefined
  expiresAt?: string | undefined
  lease: PodSubscriptionLease
}

export type PodSubscriptions = {
  list(): Promise<readonly SessionSubscription[]>
  subscribe(args: PodSubscribeArgs): Promise<{
    subscription: SessionSubscription
    existed: boolean
    updated: boolean
    target?: SubscribedTarget | undefined
  }>
  unsubscribe(args: { subscriptionId: string }): Promise<{ ended: boolean }>
}

const noSubscriptions = (): never => {
  throw new Error('this session cannot reach the control plane')
}

export const EMPTY_SUBSCRIPTIONS: PodSubscriptions = Object.freeze({
  list: async () => noSubscriptions(),
  subscribe: async () => noSubscriptions(),
  unsubscribe: async () => noSubscriptions(),
})
