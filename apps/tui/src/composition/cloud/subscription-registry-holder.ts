import type { SubscriptionRegistryPort } from '@dltech/atlas-harness'

let current: SubscriptionRegistryPort | null = null

const listeners = new Set<() => void>()

export const publishSubscriptionRegistry = (registry: SubscriptionRegistryPort | null): void => {
  if (current === registry) return

  current = registry
  for (const listener of [...listeners]) listener()
}

export const activeSubscriptionRegistry = (): SubscriptionRegistryPort | null => current

export const onSubscriptionRegistryChanged = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
