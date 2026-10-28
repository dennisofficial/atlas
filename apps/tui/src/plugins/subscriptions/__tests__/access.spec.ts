import { SubscriptionRegistryPort, type SubscriptionView } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import {
  activeSubscriptionRegistry,
  onSubscriptionRegistryChanged,
  publishSubscriptionRegistry,
} from '../../../composition/cloud/subscription-registry-holder'
import { createSubscriptionsAccess } from '../access'
import { createVisibleThread } from '../visible-thread'
import { view } from './fixtures'

class StubRegistry extends SubscriptionRegistryPort {
  listeners = new Set<() => void>()
  calls: string[] = []
  constructor(
    private readonly rows: readonly SubscriptionView[],
    private revision = 0,
  ) {
    super()
  }
  list = () => this.rows
  providers = () => []
  version = () => this.revision
  onChange = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  bump(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
  async subscribe() {
    this.calls.push('subscribe')
    return { ok: true as const, subscription: view(), existed: false }
  }
  async setStatus() {
    this.calls.push('setStatus')
    return true
  }
  async unsubscribe() {
    this.calls.push('unsubscribe')
    return true
  }
}

const accessOver = (local: StubRegistry) =>
  createSubscriptionsAccess({
    fallback: local,
    active: activeSubscriptionRegistry,
    onActiveChanged: onSubscriptionRegistryChanged,
    visible: createVisibleThread(),
    notice: { notify: () => undefined },
  })

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

describe('createSubscriptionsAccess', () => {
  it('reads the local registry until a cloud binding publishes its own', () => {
    const local = new StubRegistry([view({ id: 'local' })])
    const remote = new StubRegistry([view({ id: 'remote' })])
    const access = accessOver(local)

    try {
      expect(access.registry().list()[0]?.id).toBe('local')

      publishSubscriptionRegistry(remote)
      expect(access.registry().list()[0]?.id).toBe('remote')

      publishSubscriptionRegistry(null)
      expect(access.registry().list()[0]?.id).toBe('local')
    } finally {
      publishSubscriptionRegistry(null)
    }
  })

  it('moves its change subscription to the registry that became active', () => {
    const local = new StubRegistry([])
    const remote = new StubRegistry([])
    const access = accessOver(local)
    let heard = 0
    const stop = access.subscribe(() => (heard += 1))

    try {
      local.bump()
      expect(heard).toBe(1)

      publishSubscriptionRegistry(remote)
      expect(heard).toBe(2)
      expect(local.listeners.size).toBe(0)

      remote.bump()
      local.bump()
      expect(heard).toBe(3)

      stop()
      expect(remote.listeners.size).toBe(0)
    } finally {
      publishSubscriptionRegistry(null)
    }
  })

  it('changes its version when the active registry switches even if both read the same', () => {
    const local = new StubRegistry([])
    const access = accessOver(local)
    const before = access.version()

    try {
      publishSubscriptionRegistry(new StubRegistry([]))
      expect(access.version()).not.toBe(before)
    } finally {
      publishSubscriptionRegistry(null)
    }
  })

  it('sends the actions to whichever registry is active when they are taken', async () => {
    const local = new StubRegistry([])
    const remote = new StubRegistry([])
    const access = accessOver(local)

    try {
      access.actions.toggle(view())
      publishSubscriptionRegistry(remote)
      access.actions.remove(view())
      await settled()

      expect(local.calls).toEqual(['setStatus'])
      expect(remote.calls).toEqual(['unsubscribe'])
    } finally {
      publishSubscriptionRegistry(null)
    }
  })
})
