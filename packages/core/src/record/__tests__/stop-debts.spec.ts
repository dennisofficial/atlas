import { describe, expect, it } from 'bun:test'

import type { FactRecord } from '../../uploads/placement-facts'
import {
  STOP_OWED_KIND,
  STOP_PAID_KIND,
  owedStopScopesOf,
  stopOwedKeyOf,
  stopPaidKeyOf,
} from '../stop-debts'

const owed = (scope: string): FactRecord => ({
  type: 'fact-recorded',
  key: stopOwedKeyOf(scope),
  kind: STOP_OWED_KIND,
})

const paid = (scope: string): FactRecord => ({
  type: 'fact-recorded',
  key: stopPaidKeyOf(scope),
  kind: STOP_PAID_KIND,
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

  it('ignores facts of other kinds, even ones whose key carries a colon', () => {
    const placement: FactRecord = {
      type: 'fact-recorded',
      key: 'upload-placement:file-1',
      kind: 'upload-placement',
    }
    expect(owedStopScopesOf([placement])).toEqual([])
  })
})
