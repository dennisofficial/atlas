import { z } from 'zod'

import type { ThreadSubscriptionDto } from './sessions.types'

export enum EThreadSubscriptionStatus {
  Active = 'active',
  Paused = 'paused',
}

export type FoldedSubscription = ThreadSubscriptionDto & { id: string }

type EventRow = { type: string; body: string }

const bodyOf = (body: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return Object.fromEntries(Object.entries(parsed))
  } catch {
    return null
  }
}

const statusOf = (value: unknown): EThreadSubscriptionStatus | null =>
  value === EThreadSubscriptionStatus.Active || value === EThreadSubscriptionStatus.Paused
    ? value
    : null

export function foldSubscriptions(events: readonly EventRow[]): FoldedSubscription[] {
  const live = new Map<string, FoldedSubscription>()

  for (const event of events) {
    const body = bodyOf(event.body)
    if (body === null || typeof body.subscriptionId !== 'string') continue
    const id = body.subscriptionId

    if (event.type === 'subscription-created') {
      const target = z.json().safeParse(body.target)
      if (typeof body.provider !== 'string' || !target.success) continue
      live.set(id, {
        id,
        provider: body.provider,
        target: target.data,
        status: EThreadSubscriptionStatus.Active,
      })
      continue
    }

    if (event.type === 'subscription-changed') {
      const current = live.get(id)
      const status = statusOf(body.status)
      if (current !== undefined && status !== null) live.set(id, { ...current, status })
      continue
    }

    if (event.type === 'subscription-ended') live.delete(id)
  }

  return [...live.values()]
}
