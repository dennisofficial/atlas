import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { atlasNotificationSchema } from '../model'
import { ENotifyMoment } from '../moment'
import { ENotifyMode, notifyPlanOf, type NotifyFacts } from '../plan'
import type { NotifyPresence } from '../presence'
import { EClientSurface } from '../surface'

const NOW = '2026-11-23T14:02:00.000Z'

const facts = (overrides: Partial<NotifyFacts> = {}): NotifyFacts => ({
  moment: ENotifyMoment.TurnFinished,
  sessionId: 'session-1',
  sessionTitle: 'Fix the renderer',
  seq: 12,
  readSeq: 11,
  presence: [],
  devices: 2,
  quiet: false,
  enabled: true,
  now: NOW,
  ...overrides,
})

const presence = (overrides: Partial<NotifyPresence> = {}): NotifyPresence => ({
  surface: EClientSurface.Web,
  sessionId: 'session-1',
  foreground: true,
  at: NOW,
  ...overrides,
})

describe('notifyPlanOf', () => {
  it('stays silent when the moment is off', () => {
    expect(notifyPlanOf({ facts: facts({ enabled: false }) })).toBeNull()
  })

  it('stays silent in quiet hours', () => {
    expect(notifyPlanOf({ facts: facts({ quiet: true }) })).toBeNull()
  })

  it('stays silent when the session is already read', () => {
    expect(notifyPlanOf({ facts: facts({ readSeq: 12 }) })).toBeNull()
    expect(notifyPlanOf({ facts: facts({ readSeq: 30 }) })).toBeNull()
  })

  it('decides before the read check when readSeq is null', () => {
    expect(notifyPlanOf({ facts: facts({ readSeq: null }) })?.mode).toBe(ENotifyMode.Push)
  })

  it('stays silent when this session is on screen and in front', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ sessionId: 'session-1', foreground: true })] }),
    })

    expect(plan).toBeNull()
  })

  it('marks the session inside the app when another session is in front', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ sessionId: 'session-2', foreground: true })] }),
    })

    expect(plan?.mode).toBe(ENotifyMode.InApp)
    expect(plan?.notification).toEqual({
      sessionId: 'session-1',
      seq: 12,
      moment: ENotifyMoment.TurnFinished,
      title: 'Fix the renderer',
      body: 'Finished',
      at: NOW,
    })
  })

  it('pushes when a client is in front of the list instead of a session', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ sessionId: null, foreground: true })] }),
    })

    expect(plan?.mode).toBe(ENotifyMode.InApp)
  })

  it('pushes when no client is in front', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ foreground: false })] }),
    })

    expect(plan?.mode).toBe(ENotifyMode.Push)
  })

  it('ignores a stale presence record', () => {
    const plan = notifyPlanOf({
      facts: facts({
        presence: [presence({ at: '2026-11-23T13:00:00.000Z', foreground: true })],
      }),
    })

    expect(plan?.mode).toBe(ENotifyMode.Push)
  })

  it('stays silent when no device can receive a push', () => {
    expect(notifyPlanOf({ facts: facts({ devices: 0 }) })).toBeNull()
  })

  it('returns a notification the model schema accepts', () => {
    const plan = notifyPlanOf({ facts: facts() })
    if (plan === null) throw new Error('expected a plan')

    expect(atlasNotificationSchema.parse(plan.notification)).toEqual(plan.notification)
  })

  it('copies the words of the failed moment', () => {
    const plan = notifyPlanOf({ facts: facts({ moment: ENotifyMoment.TurnFailed }) })

    expect(plan?.notification.body).toBe('Failed — open Atlas to see why')
  })

  it('copies the words of the waiting moment and falls back to Atlas as the title', () => {
    const plan = notifyPlanOf({
      facts: facts({ moment: ENotifyMoment.WaitingForYou, sessionTitle: '  ' }),
    })

    expect(plan?.notification.title).toBe('Atlas')
    expect(plan?.notification.body).toBe('Atlas needs you')
  })
})

const recordArb: fc.Arbitrary<NotifyPresence> = fc.record({
  surface: fc.constantFrom(EClientSurface.Web, EClientSurface.Desktop, EClientSurface.Ios),
  sessionId: fc.constantFrom('session-1', 'session-2', null),
  foreground: fc.boolean(),
  at: fc.constant(NOW),
})

describe('notifyPlanOf precedence', () => {
  it('always prefers the session on screen to another session, and another session to a push', () => {
    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 6 }), (records) => {
        const awayRecords = records.map((record) => ({ ...record, foreground: false }))
        const onScreen = notifyPlanOf({
          facts: facts({ presence: [...awayRecords, presence({ foreground: true })] }),
        })
        const elsewhere = notifyPlanOf({
          facts: facts({
            presence: [...awayRecords, presence({ sessionId: 'session-9', foreground: true })],
          }),
        })
        const away = notifyPlanOf({ facts: facts({ presence: awayRecords }) })

        expect(onScreen).toBeNull()
        expect(elsewhere?.mode).toBe(ENotifyMode.InApp)
        expect(away?.mode).toBe(ENotifyMode.Push)
      }),
    )
  })
})
