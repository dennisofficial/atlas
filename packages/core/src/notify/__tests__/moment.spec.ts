import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '../../record/views/status-types'
import { ETurnEndedBy, ETurnOutcome } from '../../record/turns'
import { ENotifyMoment, notifyMomentOf, notifySettingKeyOf } from '../moment'

const momentOfEnding = (args: { outcome: ETurnOutcome; by: ETurnEndedBy }) =>
  notifyMomentOf({ ending: args, status: ESessionStatus.Idle })

describe('notifyMomentOf', () => {
  it('reports a completed turn as a finished moment', () => {
    expect(momentOfEnding({ outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent })).toBe(
      ENotifyMoment.TurnFinished,
    )
  })

  it('reports a failed turn as a failed moment', () => {
    expect(momentOfEnding({ outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Agent })).toBe(
      ENotifyMoment.TurnFailed,
    )
  })

  it('reports a turn the host interrupted as failed', () => {
    expect(momentOfEnding({ outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Host })).toBe(
      ENotifyMoment.TurnFailed,
    )
  })

  it('stays silent for an interrupted turn the operator or the agent ended', () => {
    expect(
      momentOfEnding({ outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Operator }),
    ).toBeNull()
    expect(momentOfEnding({ outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Agent })).toBeNull()
  })

  it('stays silent for a stopped turn whoever stopped it', () => {
    for (const by of [ETurnEndedBy.Operator, ETurnEndedBy.Agent, ETurnEndedBy.Host]) {
      expect(momentOfEnding({ outcome: ETurnOutcome.Stopped, by })).toBeNull()
    }
  })

  it('reports a parked turn that waits for the operator', () => {
    expect(notifyMomentOf({ ending: null, status: ESessionStatus.WaitingForOperator })).toBe(
      ENotifyMoment.WaitingForYou,
    )
  })

  it('reports a parked turn that waits for credentials', () => {
    expect(notifyMomentOf({ ending: null, status: ESessionStatus.WaitingForCredentials })).toBe(
      ENotifyMoment.WaitingForYou,
    )
  })

  it('stays silent for a parked turn that waits for nothing', () => {
    for (const status of [
      ESessionStatus.Idle,
      ESessionStatus.Thinking,
      ESessionStatus.WaitingForBackground,
    ]) {
      expect(notifyMomentOf({ ending: null, status })).toBeNull()
    }
  })

  it('lets the ending decide when a status also waits for the operator', () => {
    expect(
      notifyMomentOf({
        ending: { outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
        status: ESessionStatus.WaitingForOperator,
      }),
    ).toBe(ENotifyMoment.TurnFinished)
  })
})

describe('notifySettingKeyOf', () => {
  it('maps each moment to the settings event id the page uses', () => {
    expect(notifySettingKeyOf(ENotifyMoment.TurnFinished)).toBe('finished')
    expect(notifySettingKeyOf(ENotifyMoment.TurnFailed)).toBe('errored')
    expect(notifySettingKeyOf(ENotifyMoment.WaitingForYou)).toBe('approval')
  })
})
