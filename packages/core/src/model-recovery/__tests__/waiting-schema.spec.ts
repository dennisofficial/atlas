import { describe, expect, it } from 'bun:test'

import type { EventBody } from '../../events/body'
import { eventBodySchema } from '../../events/schema'
import { EModelWaitCause, waitEpisodeRefSchema, waitingForModelSchema } from '../waiting'
import { controlPlaneEpisode, credentialEpisode, waiting } from './waiting-fixtures'

describe('waiting schemas', () => {
  it('round-trips both episode arms and rejects unknown fields', () => {
    for (const episode of [
      credentialEpisode({ accountId: 'a1', generation: 0 }),
      controlPlaneEpisode('authority-unavailable'),
      controlPlaneEpisode('credential-not-configured', 'm1'),
    ]) {
      expect(waitEpisodeRefSchema.parse(episode)).toEqual(episode)
    }
    expect(
      waitEpisodeRefSchema.safeParse({
        ...controlPlaneEpisode('x'),
        extra: true,
      }).success,
    ).toBe(false)
  })

  it('round-trips waiting views, with and without a reason', () => {
    const views = [
      waiting({
        episode: credentialEpisode({ accountId: 'a1', generation: 1 }),
        resetAt: '2026-11-05T00:00:00.000Z',
      }),
      waiting({
        episode: controlPlaneEpisode('authority-unavailable'),
        reason: null,
      }),
    ]
    for (const view of views) expect(waitingForModelSchema.parse(view)).toEqual(view)
  })

  it('round-trips both events through eventBodySchema', () => {
    const episode = credentialEpisode({ accountId: 'a1', generation: 1 })
    const bodies: EventBody[] = [
      { type: 'model-waiting', waiting: waiting({ episode }) },
      {
        type: 'model-wait-cleared',
        episode: controlPlaneEpisode('authority-unavailable'),
        cause: EModelWaitCause.ControlPlane,
      },
      {
        type: 'model-wait-cleared',
        episode,
        cause: EModelWaitCause.Availability,
      },
    ]
    for (const body of bodies) expect(eventBodySchema.parse(body)).toEqual(body)
    expect(eventBodySchema.safeParse({ type: 'model-waiting' }).success).toBe(false)
    expect(
      eventBodySchema.safeParse({
        type: 'model-wait-cleared',
        episode,
        cause: 'nope',
      }).success,
    ).toBe(false)
  })
})
