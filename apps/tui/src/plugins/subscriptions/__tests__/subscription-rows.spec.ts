import { ESubscriptionActor, ESubscriptionStatus } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { flattenedSpans } from '../../../ui/sidebar-section'
import { theme } from '../../../ui/theme'
import { REMOVE_GLYPH, statusText, subscriptionsSection } from '../subscription-rows'
import { OTHER_THREAD, view } from './fixtures'

const NEVER = (): void => undefined

const section = (views: Parameters<typeof subscriptionsSection>[0]['views']) =>
  subscriptionsSection({ views, onToggle: NEVER, onRemove: NEVER })

const textOf = (row: NonNullable<ReturnType<typeof section>>['rows'][number]): string =>
  flattenedSpans({ row, cells: 40 })
    .map((span) => span.text)
    .join('')

describe('subscriptionsSection', () => {
  it('draws nothing when the session has no subscription', () => {
    expect(section([])).toBeNull()
  })

  it('lists every subscription of the session, whichever thread owns it', () => {
    const found = section([view({ id: 'mine' }), view({ id: 'theirs', threadId: OTHER_THREAD })])

    expect(found?.rows.map((row) => row.id).toSorted()).toEqual([
      'subscription-mine',
      'subscription-theirs',
    ])
  })

  it('lists the oldest subscription first, each with its label and provider', () => {
    const found = section([
      view({ id: 'late', label: 'o/r#9', createdAt: '2026-10-28T12:00:00.000Z' }),
      view({ id: 'early' }),
    ])

    expect(found?.label).toBe('Subscriptions')
    expect(found?.rows.map((row) => row.id)).toEqual(['subscription-early', 'subscription-late'])
    expect(found?.rows[0] && textOf(found.rows[0])).toStartWith('o/r#7 pr')
  })

  it('names who made it, in the accent, and the operator as you', () => {
    const found = section([view(), view({ id: 'mine', createdBy: ESubscriptionActor.Operator })])
    const [agent, mine] = found?.rows ?? []

    expect(agent && textOf(agent)).toEndWith('agent')
    expect(mine && textOf(mine)).toEndWith('you')
    const accent =
      agent && flattenedSpans({ row: agent, cells: 40 }).find((s) => s.text === 'agent')
    expect(accent?.fg).toBe(theme.accent)
  })

  it('offers pause through the row and removal through its own action', () => {
    const calls: string[] = []
    const found = subscriptionsSection({
      views: [view()],
      onToggle: (picked) => calls.push(`toggle ${picked.id}`),
      onRemove: (picked) => calls.push(`remove ${picked.id}`),
    })
    const row = found?.rows[0]

    row?.onActivate?.()
    row?.action?.onActivate()

    expect(row?.action?.glyph).toBe(REMOVE_GLYPH)
    expect(calls).toEqual(['toggle sub-1', 'remove sub-1'])
  })
})

describe('statusText', () => {
  it('is empty for a plain active subscription', () => {
    expect(statusText(view())).toBe('')
  })

  it('says paused, and how many occurrences are held', () => {
    expect(statusText(view({ status: ESubscriptionStatus.Paused }))).toBe('paused')
    expect(statusText(view({ held: 3 }))).toBe('3 held')
    expect(statusText(view({ status: ESubscriptionStatus.Paused, held: 2 }))).toBe('paused, 2 held')
  })

  it('says when it expires', () => {
    expect(statusText(view({ expiresAt: '2026-10-28T14:30:00.000' }))).toMatch(/^expires 2:30pm$/)
  })
})
