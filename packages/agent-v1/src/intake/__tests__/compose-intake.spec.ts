import { describe, expect, it } from 'bun:test'

import { toThreadId, type EventDraft } from '@dltech/atlas-core'

import { composeIntake } from '../compose-intake'

const said = (text: string): EventDraft => ({ type: 'user-said', text })

describe('composed intake', () => {
  it('leads with the first source but captures it last, so input arriving during the later drains joins this batch', async () => {
    const steering: string[] = []
    const intake = composeIntake([
      {
        prepare: async () => ({
          drafts: steering.map(said),
          wakesTurn: steering.length > 0,
          acknowledge: () => undefined,
        }),
      },
      {
        prepare: async () => {
          steering.push('arrived during the notice drain')
          return { drafts: [said('notice')], wakesTurn: true, acknowledge: () => undefined }
        },
      },
    ])

    const batch = await intake.prepare({ threadId: toThreadId('thr_1') })

    expect(batch.drafts).toEqual([said('arrived during the notice drain'), said('notice')])
  })

  it('releases what it already captured when a later capture throws', async () => {
    let released = false
    const intake = composeIntake([
      {
        prepare: async () => {
          throw new Error('steering failed')
        },
      },
      {
        prepare: async () => ({
          drafts: [said('notice')],
          wakesTurn: true,
          acknowledge: () => undefined,
          release: () => {
            released = true
          },
        }),
      },
    ])

    await expect(intake.prepare({ threadId: toThreadId('thr_1') })).rejects.toThrow(
      'steering failed',
    )
    expect(released).toBe(true)
  })
})
