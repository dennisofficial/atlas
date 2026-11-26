import { describe, expect, it } from 'bun:test'

import type { FactRecord } from '../../uploads/placement-facts'
import {
  STOP_OWED_KIND,
  STOP_PAID_KIND,
  owedStopScopesOf,
  stopDebtMarkOf,
  stopOwedKeyOf,
  stopPaidKeyOf,
  type StopDebtMark,
} from '../stop-debts'

const owedFact = (scope: string): FactRecord => ({
  type: 'fact-recorded',
  key: stopOwedKeyOf(scope),
  kind: STOP_OWED_KIND,
})

const paidFact = (scope: string): FactRecord => ({
  type: 'fact-recorded',
  key: stopPaidKeyOf(scope),
  kind: STOP_PAID_KIND,
})

const owed = (scope: string): StopDebtMark => ({ kind: 'owed', scope })

const paid = (scope: string): StopDebtMark => ({ kind: 'paid', scope })

const dispatched = (scope: string): StopDebtMark => ({ kind: 'dispatched', scope })

describe('stopDebtMarkOf', () => {
  it('marks the stop-owed and stop-paid facts and nothing else', () => {
    const placement: FactRecord = {
      type: 'fact-recorded',
      key: 'upload-placement:file-1',
      kind: 'upload-placement',
    }

    expect(stopDebtMarkOf(owedFact('call-a'))).toEqual({ kind: 'owed', scope: 'call-a' })
    expect(stopDebtMarkOf(paidFact('call-a'))).toEqual({ kind: 'paid', scope: 'call-a' })
    expect(stopDebtMarkOf(placement)).toBeUndefined()
  })
})

describe('owedStopScopesOf', () => {
  it('reports a stopped call whose pod work nobody cancelled yet', () => {
    expect(owedStopScopesOf([owed('call-a')])).toEqual(['call-a'])
  })

  it('reports nothing once the scope cancel is confirmed', () => {
    expect(owedStopScopesOf([owed('call-a'), paid('call-a')])).toEqual([])
  })

  it('reports one scope once however many times it was owed', () => {
    expect(owedStopScopesOf([owed('call-a'), owed('call-a')])).toEqual(['call-a'])
  })

  it('reports only the scopes still owed', () => {
    expect(owedStopScopesOf([owed('call-a'), paid('call-a'), owed('call-b')])).toEqual(['call-b'])
  })

  it('owes a scope again when a later stop owes it after it was paid', () => {
    expect(owedStopScopesOf([owed('call-a'), paid('call-a'), owed('call-a')])).toEqual(['call-a'])
  })

  it('keeps the debt when the dispatch that ran it came before the stop', () => {
    expect(owedStopScopesOf([dispatched('call-a'), owed('call-a')])).toEqual(['call-a'])
  })

  it('drops a debt that a later dispatch of the same scope re-uses', () => {
    expect(owedStopScopesOf([owed('call-a'), dispatched('call-a')])).toEqual([])
  })

  it('drops only the re-dispatched scope', () => {
    expect(owedStopScopesOf([owed('call-a'), owed('call-b'), dispatched('call-b')])).toEqual([
      'call-a',
    ])
  })

  it('reports nothing when no stop was ever owed', () => {
    expect(owedStopScopesOf([])).toEqual([])
  })
})
