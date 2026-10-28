import { ESubscriptionStatus } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { theme } from '../../../ui/theme'
import { BELL_IDLE, BELL_SUBSCRIBED, bellFor, subscriptionTo } from '../bell'
import { OTHER_THREAD, REPO, view } from './fixtures'

const NEVER = (): void => undefined

const bell = (args: { views: Parameters<typeof bellFor>[0]['views']; number?: number }) =>
  bellFor({
    views: args.views,
    repo: REPO,
    number: args.number ?? 7,
    ring: NEVER,
  })

describe('bellFor', () => {
  it('is hollow when the session does not follow the pull request', () => {
    expect(bell({ views: [] })?.glyph).toBe(BELL_IDLE)
    expect(bell({ views: [view()], number: 8 })?.glyph).toBe(BELL_IDLE)
    expect(bell({ views: [view({ provider: 'timer.clock' })] })?.glyph).toBe(BELL_IDLE)
  })

  it('is filled green when subscribed and amber when paused', () => {
    expect(bell({ views: [view()] })).toMatchObject({ glyph: BELL_SUBSCRIBED, fg: theme.ok })
    expect(bell({ views: [view({ status: ESubscriptionStatus.Paused })] })).toMatchObject({
      glyph: BELL_SUBSCRIBED,
      fg: theme.warn,
    })
  })

  it('is filled when another thread of the session holds the subscription', () => {
    const standing = view({ threadId: OTHER_THREAD })

    expect(bell({ views: [standing] })).toMatchObject({ glyph: BELL_SUBSCRIBED, fg: theme.ok })
  })

  it('matches the repository case-insensitively', () => {
    const standing = view({ target: { repo: 'github.com/O/R', number: 7 } })

    expect(bell({ views: [standing] })?.glyph).toBe(BELL_SUBSCRIBED)
  })

  it('hands the click the standing subscription, or null when there is none', () => {
    const rung: unknown[] = []
    const ring = (existing: unknown) => rung.push(existing)
    const standing = view()

    bellFor({ views: [], repo: REPO, number: 7, ring })?.onActivate()
    bellFor({ views: [standing], repo: REPO, number: 7, ring })?.onActivate()

    expect(rung).toEqual([null, standing])
  })

  it('offers no bell for a repository that is not on github.com', () => {
    expect(bellFor({ views: [], repo: 'gitlab.com/o/r', number: 7, ring: NEVER })).toBeUndefined()
  })
})

describe('subscriptionTo', () => {
  it('matches on repo and number, not on label', () => {
    expect(subscriptionTo({ views: [view({ label: 'x' })], repo: REPO, number: 7 })).not.toBeNull()
  })
})
