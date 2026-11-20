import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionTone,
  neutralPresentationOf,
  NEUTRAL_SUBSCRIPTION_ICON,
  presentSubscription,
  subscriptionPresentationSchema,
  type SubscriptionPresentation,
  type SubscriptionPresentationInput,
} from '..'
import { ESubscriptionStatus } from '../subscription'

const input = (
  overrides: Partial<SubscriptionPresentationInput> = {},
): SubscriptionPresentationInput => ({
  provider: 'probe.thing',
  label: 'probe#1',
  target: { id: 1 },
  status: ESubscriptionStatus.Active,
  events: [],
  ...overrides,
})

const probe: SubscriptionPresentation = {
  icon: 'radar',
  tone: ESubscriptionTone.Open,
  title: 'Probe #1',
  meta: ['Probe'],
}

describe('presentSubscription', () => {
  it('falls back to a neutral presentation for a provider with no presenter', () => {
    expect(presentSubscription({ input: input(), presenters: {} })).toEqual({
      icon: NEUTRAL_SUBSCRIPTION_ICON,
      tone: ESubscriptionTone.Neutral,
      title: 'probe#1',
      meta: [],
    })
    expect(neutralPresentationOf(input({ label: 'other' })).title).toBe('other')
  })

  it('hands the row to the presenter that registered the provider', () => {
    const seen: SubscriptionPresentationInput[] = []
    const presentation = presentSubscription({
      input: input({ events: ['ci'] }),
      presenters: {
        'probe.thing': (given) => {
          seen.push(given)
          return probe
        },
      },
    })
    expect(presentation).toEqual(probe)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.events).toEqual(['ci'])
  })

  it('round-trips through its schema and refuses an unknown tone', () => {
    expect(subscriptionPresentationSchema.parse(JSON.parse(JSON.stringify(probe)))).toEqual(probe)
    expect(subscriptionPresentationSchema.safeParse({ ...probe, tone: 'sleeping' }).success).toBe(
      false,
    )
  })
})
