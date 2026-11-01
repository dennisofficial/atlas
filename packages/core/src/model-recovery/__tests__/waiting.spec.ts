import { describe, expect, it } from 'bun:test'

import { EProviderFailureKind } from '../../models/provider-failure'
import { projectWaiting, waitEpisodeGroupKey } from '../waiting-projector'
import {
  clears,
  controlPlaneEpisode,
  credentialEpisode,
  stamp,
  threads,
  waiting,
  waits,
} from './waiting-fixtures'

describe('projectWaiting', () => {
  it('is empty when nothing waits', () => {
    expect(projectWaiting([])).toEqual([])
  })

  it('groups credential episodes by availability key, excluding generation', () => {
    const first = credentialEpisode({ accountId: 'a1', generation: 1 })
    const later = credentialEpisode({ accountId: 'a1', generation: 2 })
    expect(waitEpisodeGroupKey(first)).toBe(waitEpisodeGroupKey(later))
    expect(waitEpisodeGroupKey(first)).not.toBe(
      waitEpisodeGroupKey(credentialEpisode({ accountId: 'a2', generation: 1 })),
    )
    expect(waitEpisodeGroupKey(first)).not.toBe(
      waitEpisodeGroupKey(credentialEpisode({ accountId: 'a1', generation: 1, modelId: 'other' })),
    )
  })

  it('keeps credential and control-plane episodes apart even with matching names', () => {
    const events = [
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 1 }),
        }),
      ),
      waits(
        waiting({
          episode: controlPlaneEpisode('authority-unavailable'),
          reason: null,
        }),
      ),
      waits(
        waiting({
          episode: controlPlaneEpisode('credential-not-configured'),
          reason: null,
        }),
      ),
      waits(
        waiting({
          episode: controlPlaneEpisode('authority-unavailable', 'm1'),
          reason: null,
        }),
      ),
    ]
    expect(projectWaiting(events)).toHaveLength(4)
  })

  it('merges affected threads of observations that share a key', () => {
    const episode = credentialEpisode({ accountId: 'a1', generation: 1 })
    const [only] = projectWaiting([
      waits(waiting({ episode, affectedThreadIds: threads('t1', 't2') })),
      waits(waiting({ episode, affectedThreadIds: threads('t2', 't3') })),
    ])
    expect(only?.affectedThreadIds).toEqual(threads('t1', 't2', 't3'))
  })

  it('takes reason and reset from the newest generation and keeps merged threads', () => {
    const [only, ...rest] = projectWaiting([
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 1 }),
          reason: EProviderFailureKind.RateLimited,
          resetAt: '2026-11-02T00:00:00.000Z',
          affectedThreadIds: threads('t1'),
        }),
      ),
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 2 }),
          reason: EProviderFailureKind.Quota,
          resetAt: '2026-11-05T00:00:00.000Z',
          affectedThreadIds: threads('t2'),
        }),
      ),
    ])
    expect(rest).toEqual([])
    expect(only?.episode).toEqual(credentialEpisode({ accountId: 'a1', generation: 2 }))
    expect(only?.reason).toBe(EProviderFailureKind.Quota)
    expect(only?.resetAt).toBe('2026-11-05T00:00:00.000Z')
    expect(only?.affectedThreadIds).toEqual(threads('t1', 't2'))
  })

  it('ignores reason and reset from an older generation but still merges its threads', () => {
    const [only] = projectWaiting([
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 3 }),
          reason: EProviderFailureKind.Quota,
          resetAt: '2026-11-05T00:00:00.000Z',
        }),
      ),
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 2 }),
          reason: EProviderFailureKind.RateLimited,
          resetAt: null,
          affectedThreadIds: threads('t9'),
        }),
      ),
    ])
    expect(only?.episode).toEqual(credentialEpisode({ accountId: 'a1', generation: 3 }))
    expect(only?.reason).toBe(EProviderFailureKind.Quota)
    expect(only?.resetAt).toBe('2026-11-05T00:00:00.000Z')
    expect(only?.affectedThreadIds).toEqual(threads('t1', 't9'))
  })

  it('lets a manual pause overlay carry no provider reason or reset', () => {
    const [only] = projectWaiting([
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 1 }),
          reason: EProviderFailureKind.Quota,
          resetAt: '2026-11-05T00:00:00.000Z',
        }),
      ),
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 2 }),
          reason: null,
          resetAt: null,
        }),
      ),
    ])
    expect(only?.reason).toBeNull()
    expect(only?.resetAt).toBeNull()
  })

  it('drops an episode on its matching clear and leaves the others', () => {
    const a1 = credentialEpisode({ accountId: 'a1', generation: 1 })
    const a2 = credentialEpisode({ accountId: 'a2', generation: 1 })
    const result = projectWaiting([
      waits(waiting({ episode: a1 })),
      waits(waiting({ episode: a2 })),
      clears(a1),
    ])
    expect(result.map((item) => item.episode)).toEqual([a2])
  })

  it('clears a control-plane episode by its code key only', () => {
    const outage = controlPlaneEpisode('authority-unavailable')
    const missing = controlPlaneEpisode('credential-not-configured')
    const result = projectWaiting([
      waits(waiting({ episode: outage, reason: null })),
      waits(waiting({ episode: missing, reason: null })),
      clears(outage),
    ])
    expect(result.map((item) => item.episode)).toEqual([missing])
  })

  it('does not let a control-plane clear touch a credential episode or the reverse', () => {
    const credential = credentialEpisode({ accountId: 'a1', generation: 1 })
    const outage = controlPlaneEpisode('authority-unavailable')
    const result = projectWaiting([
      waits(waiting({ episode: credential })),
      waits(waiting({ episode: outage, reason: null })),
      clears(controlPlaneEpisode('authority-unavailable', 'other-model')),
      clears(credentialEpisode({ accountId: 'a2', generation: 1 })),
    ])
    expect(result).toHaveLength(2)
  })

  it('ignores a clear for a generation older than the unresolved episode', () => {
    const result = projectWaiting([
      waits(
        waiting({
          episode: credentialEpisode({ accountId: 'a1', generation: 2 }),
        }),
      ),
      clears(credentialEpisode({ accountId: 'a1', generation: 1 })),
    ])
    expect(result).toHaveLength(1)
  })

  it('starts a fresh episode when a block follows a clear', () => {
    const episode = credentialEpisode({ accountId: 'a1', generation: 1 })
    const result = projectWaiting([
      waits(waiting({ episode, affectedThreadIds: threads('t1') })),
      clears(episode),
      waits(waiting({ episode, affectedThreadIds: threads('t2') })),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.affectedThreadIds).toEqual(threads('t2'))
  })

  it('ignores events that are not waiting bookkeeping', () => {
    expect(projectWaiting([stamp({ type: 'run-failure-dismissed', failureSeq: 1 })])).toEqual([])
  })
})
