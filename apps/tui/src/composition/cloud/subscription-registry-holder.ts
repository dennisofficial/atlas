import type { SubscriptionRegistryPort } from '@dltech/atlas-harness'

let current: SubscriptionRegistryPort | null = null

export const publishSubscriptionRegistry = (registry: SubscriptionRegistryPort | null): void => {
  current = registry
}

export const activeSubscriptionRegistry = (): SubscriptionRegistryPort | null => current
