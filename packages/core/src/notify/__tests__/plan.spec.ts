import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { atlasNotificationSchema } from '../model'
import { ENotifyMoment } from '../moment'
import {
  ENotifyMode,
  ENotifySkip,
  notifyPlanOf,
  pushNotificationOf,
  type NotifyFacts,
} from '../plan'
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
  superseded: false,
  nested: false,
  operatorTurn: false,
  recentPush: false,
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

const reasonOf = (overrides: Partial<NotifyFacts>): ENotifySkip | undefined => {
  const plan = notifyPlanOf({ facts: facts(overrides) })
  return plan.mode === ENotifyMode.Silent ? plan.reason : undefined
}

describe('notifyPlanOf', () => {
  it('stays silent with the reason that the moment is off', () => {
    expect(notifyPlanOf({ facts: facts({ enabled: false }) })).toEqual({
      mode: ENotifyMode.Silent,
      reason: ENotifySkip.Disabled,
    })
  })

  it('stays silent with the reason of quiet hours', () => {
    expect(notifyPlanOf({ facts: facts({ quiet: true }) })).toEqual({
      mode: ENotifyMode.Silent,
      reason: ENotifySkip.Quiet,
    })
  })

  it('stays silent with the reason that the session is already read', () => {
    expect(reasonOf({ readSeq: 12 })).toBe(ENotifySkip.Read)
    expect(reasonOf({ readSeq: 30 })).toBe(ENotifySkip.Read)
  })

  it('decides before the read check when readSeq is null', () => {
    expect(notifyPlanOf({ facts: facts({ readSeq: null }) })?.mode).toBe(ENotifyMode.Push)
  })

  it('stays silent with the reason that this session is on screen and in front', () => {
    expect(reasonOf({ presence: [presence({ sessionId: 'session-1', foreground: true })] })).toBe(
      ENotifySkip.OnScreen,
    )
  })

  it('marks the session inside the app when another session is in front', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ sessionId: 'session-2', foreground: true })] }),
    })

    expect(plan.mode).toBe(ENotifyMode.InApp)
    expect(pushNotificationOf(plan)).toBeNull()
    expect(plan.mode === ENotifyMode.Silent ? undefined : plan.notification).toEqual({
      sessionId: 'session-1',
      seq: 12,
      moment: ENotifyMoment.TurnFinished,
      title: 'Fix the renderer',
      body: 'Finished',
      at: NOW,
    })
  })

  it('marks the session inside the app when a client is in front of the list', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ sessionId: null, foreground: true })] }),
    })

    expect(plan.mode).toBe(ENotifyMode.InApp)
  })

  it('pushes when no client is in front', () => {
    const plan = notifyPlanOf({
      facts: facts({ presence: [presence({ foreground: false })] }),
    })

    expect(plan.mode).toBe(ENotifyMode.Push)
  })

  it('ignores a stale presence record', () => {
    const plan = notifyPlanOf({
      facts: facts({
        presence: [presence({ at: '2026-11-23T13:00:00.000Z', foreground: true })],
      }),
    })

    expect(plan.mode).toBe(ENotifyMode.Push)
  })

  it('stays silent with the reason that no device can receive a push', () => {
    expect(notifyPlanOf({ facts: facts({ devices: 0 }) })).toEqual({
      mode: ENotifyMode.Silent,
      reason: ENotifySkip.NoDevices,
    })
  })

  it('returns a notification the model schema accepts', () => {
    const plan = notifyPlanOf({ facts: facts() })
    const notification = pushNotificationOf(plan)
    if (notification === null) throw new Error('expected a push plan')

    expect(atlasNotificationSchema.parse(notification)).toEqual(notification)
  })

  it('copies the words of the failed moment', () => {
    const notification = pushNotificationOf(
      notifyPlanOf({ facts: facts({ moment: ENotifyMoment.TurnFailed }) }),
    )

    expect(notification?.body).toBe('Failed — open Atlas to see why')
  })

  it('copies the words of the waiting moment and falls back to Atlas as the title', () => {
    const notification = pushNotificationOf(
      notifyPlanOf({ facts: facts({ moment: ENotifyMoment.WaitingForYou, sessionTitle: '  ' }) }),
    )

    expect(notification?.title).toBe('Atlas')
    expect(notification?.body).toBe('Atlas needs you')
  })
})

describe('notifyPlanOf reasons in order', () => {
  it('reports a superseded moment before every other reason', () => {
    expect(
      reasonOf({
        superseded: true,
        nested: true,
        enabled: false,
        quiet: true,
        readSeq: 12,
        presence: [presence({ foreground: true })],
        devices: 0,
      }),
    ).toBe(ENotifySkip.Superseded)
  })

  it('reports a nested agent turn before the settings and the quiet hours', () => {
    expect(reasonOf({ nested: true, enabled: false, quiet: true })).toBe(
      ENotifySkip.NestedAgentTurn,
    )
  })

  it('reports the disabled moment before the quiet hours', () => {
    expect(reasonOf({ enabled: false, quiet: true })).toBe(ENotifySkip.Disabled)
  })

  it('reports the quiet hours before a read session', () => {
    expect(reasonOf({ quiet: true, readSeq: 12 })).toBe(ENotifySkip.Quiet)
  })

  it('reports a read session before the presence', () => {
    expect(reasonOf({ readSeq: 12, presence: [presence({ foreground: true })] })).toBe(
      ENotifySkip.Read,
    )
  })

  it('reports the on-screen session before the devices', () => {
    expect(reasonOf({ presence: [presence({ foreground: true })], devices: 0 })).toBe(
      ENotifySkip.OnScreen,
    )
  })
})

describe('notifyPlanOf nested sessions', () => {
  it('stays silent for a nested finished turn the operator did not start', () => {
    expect(notifyPlanOf({ facts: facts({ nested: true, operatorTurn: false }) })).toEqual({
      mode: ENotifyMode.Silent,
      reason: ENotifySkip.NestedAgentTurn,
    })
  })

  it('pushes for a nested finished turn the operator started', () => {
    expect(notifyPlanOf({ facts: facts({ nested: true, operatorTurn: true }) }).mode).toBe(
      ENotifyMode.Push,
    )
  })

  it('pushes a nested failed turn without an operator turn', () => {
    const plan = notifyPlanOf({
      facts: facts({ nested: true, operatorTurn: false, moment: ENotifyMoment.TurnFailed }),
    })

    expect(plan.mode).toBe(ENotifyMode.Push)
  })

  it('pushes a nested waiting moment without an operator turn', () => {
    const plan = notifyPlanOf({
      facts: facts({ nested: true, operatorTurn: false, moment: ENotifyMoment.WaitingForYou }),
    })

    expect(plan.mode).toBe(ENotifyMode.Push)
  })
})

describe('notifyPlanOf sound', () => {
  it('makes a sound for the first push of a burst', () => {
    const plan = notifyPlanOf({ facts: facts({ recentPush: false }) })

    expect(plan.mode === ENotifyMode.Silent ? undefined : plan.sound).toBe(true)
  })

  it('stays quiet when another push landed inside the burst window', () => {
    const plan = notifyPlanOf({ facts: facts({ recentPush: true }) })

    expect(plan.mode === ENotifyMode.Silent ? undefined : plan.sound).toBe(false)
  })

  it('stays quiet for an in-app notice inside the burst window', () => {
    const plan = notifyPlanOf({
      facts: facts({ recentPush: true, presence: [presence({ sessionId: 'session-2' })] }),
    })

    expect(plan.mode).toBe(ENotifyMode.InApp)
    expect(plan.mode === ENotifyMode.Silent ? undefined : plan.sound).toBe(false)
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

        expect(onScreen.mode).toBe(ENotifyMode.Silent)
        expect(elsewhere.mode).toBe(ENotifyMode.InApp)
        expect(away.mode).toBe(ENotifyMode.Push)
      }),
    )
  })
})
