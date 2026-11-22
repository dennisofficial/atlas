import { ESubscriptionActor } from '@dltech/atlas-core'
import type { PodSubscriptionLease, PodSubscriptions } from '@dltech/atlas-plugin-sdk'
import type { SessionSubscription } from '@dltech/atlas-protocol'

export const NOW = '2026-11-08T10:00:00.000Z'
export const EXPIRES = '2026-11-09T10:00:00.000Z'

export const subscriptionRow = (patch: Partial<SessionSubscription> = {}): SessionSubscription => ({
  id: 'sub-1',
  threadId: 't1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/o/r', number: 2 },
  label: 'o/r#2',
  events: [],
  createdBy: ESubscriptionActor.Agent,
  createdAt: NOW,
  expiresAt: EXPIRES,
  ...patch,
})

const sameEvents = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((event, index) => event === b[index])
}

const targetKey = (args: { provider: string; target: unknown }): string =>
  `${args.provider}|${JSON.stringify(args.target)}`

export const fakeSubscriptions = (initial: readonly SessionSubscription[] = []) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  const calls: string[] = []
  const leases: PodSubscriptionLease[] = []
  let made = 0
  const port: PodSubscriptions = {
    list: async () => {
      calls.push('list')
      return [...rows.values()]
    },
    subscribe: async (input) => {
      calls.push(`subscribe:${input.provider}`)
      leases.push(input.lease)
      const held = [...rows.values()].find((row) => targetKey(row) === targetKey(input))
      const events = [...(input.events ?? held?.events ?? [])]
      const expiresAt = input.expiresAt ?? held?.expiresAt ?? EXPIRES
      if (held !== undefined) {
        if (sameEvents(held.events, events) && held.expiresAt === expiresAt) {
          return { subscription: held, existed: true, updated: false }
        }
        const updated: SessionSubscription = {
          ...held,
          provider: input.provider,
          target: input.target,
          label: input.label,
          events,
          expiresAt,
        }
        rows.set(updated.id, updated)
        return { subscription: updated, existed: true, updated: true }
      }
      made += 1
      const row = subscriptionRow({
        id: `sub-${made}`,
        provider: input.provider,
        target: input.target,
        label: input.label,
        events,
        expiresAt,
      })
      rows.set(row.id, row)
      return { subscription: row, existed: false, updated: false }
    },
    unsubscribe: async ({ subscriptionId }) => {
      calls.push(`unsubscribe:${subscriptionId}`)
      return { ended: rows.delete(subscriptionId) }
    },
  }
  return { port, rows, calls, leases }
}
