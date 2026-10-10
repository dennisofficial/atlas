import { checkoutKey, type RepositoryCheckout } from './pure'

export type Reconciled = {
  gained: readonly RepositoryCheckout[]
  lost: readonly string[]
  visibleChanged: boolean
}

export type TrackedCheckouts = {
  reconcile: (args: {
    checkouts: readonly RepositoryCheckout[]
    visible?: RepositoryCheckout | null
  }) => Reconciled
  get: (args: { key: string }) => RepositoryCheckout | null
  list: () => readonly RepositoryCheckout[]
  visible: () => RepositoryCheckout | null
  clear: () => void
}

export function createTrackedCheckouts(): TrackedCheckouts {
  const held = new Map<string, RepositoryCheckout>()
  let visibleKey: string | null = null

  return {
    reconcile: ({ checkouts, visible }) => {
      const next = new Map(checkouts.map((checkout) => [checkoutKey(checkout), checkout]))

      const lost: string[] = []
      for (const key of [...held.keys()]) {
        if (next.has(key)) continue

        held.delete(key)
        lost.push(key)
      }

      const gained: RepositoryCheckout[] = []
      for (const [key, checkout] of next) {
        if (!held.has(key)) gained.push(checkout)
        held.set(key, checkout)
      }

      const previous = visibleKey
      if (visible !== undefined) visibleKey = visible === null ? null : checkoutKey(visible)
      if (visibleKey !== null && !held.has(visibleKey)) visibleKey = null
      if (visibleKey === null && visible === undefined) visibleKey = held.keys().next().value ?? null

      return { gained, lost, visibleChanged: previous !== visibleKey }
    },
    get: ({ key }) => held.get(key) ?? null,
    list: () => [...held.values()],
    visible: () => (visibleKey === null ? null : (held.get(visibleKey) ?? null)),
    clear: () => {
      held.clear()
      visibleKey = null
    },
  }
}
