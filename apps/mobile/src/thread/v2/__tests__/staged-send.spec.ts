import { describe, expect, it } from 'bun:test'

import { clientIdOfSend, draftAfterSettlementOf, settlementOf } from '../staged-send'
import { v2EventSchema } from '../registered-plugins'

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_1',
  runId: 'run_1',
  depth: 0,
  at: `2026-11-08T20:00:0${seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const eventsOf = (events: readonly unknown[]) => events.map((event) => v2EventSchema.parse(event))

const STAGED = [{ clientId: 'client-a', text: 'first', attachments: [] }]

describe('clientIdOfSend', () => {
  it('keeps the id of a failed post so the retry does not land twice', () => {
    const minted: string[] = []
    const mint = () => {
      minted.push('minted')
      return 'minted'
    }
    expect(clientIdOfSend({ retry: undefined, mint })).toBe('minted')
    expect(clientIdOfSend({ retry: 'minted', mint })).toBe('minted')
    expect(minted).toHaveLength(1)
  })
})

describe('settlementOf', () => {
  it('keeps a staged message while the log has nothing for its client id', () => {
    const settlement = settlementOf({ staged: STAGED, events: [] })
    expect(settlement.kept).toEqual(STAGED)
    expect(settlement.restored).toEqual([])
    expect(settlement.notices).toEqual([])
  })

  it('drops a staged message once the log carries it', () => {
    const settlement = settlementOf({
      staged: STAGED,
      events: eventsOf([
        { ...envelope(1), type: 'user-said', text: 'first', clientId: 'client-a' },
      ]),
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual([])
  })

  it('restores the text of a refused message with the reason', () => {
    const settlement = settlementOf({
      staged: STAGED,
      events: eventsOf([
        {
          ...envelope(1),
          type: 'input-refused',
          inboxId: 1,
          clientId: 'client-a',
          reason: 'session is archived',
        },
      ]),
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual(['first'])
    expect(settlement.notices).toEqual(['session is archived'])
  })

  it('restores the text of a withdrawn message without a notice', () => {
    const settlement = settlementOf({
      staged: STAGED,
      events: eventsOf([
        {
          ...envelope(1),
          type: 'input-posted',
          inboxId: 1,
          kind: 'message',
          postedAt: '2026-11-08T20:00:01.000Z',
          message: { text: 'first', clientId: 'client-a' },
        },
        { ...envelope(2), type: 'input-withdrawn', inboxId: 1 },
      ]),
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual(['first'])
    expect(settlement.notices).toEqual([])
  })

  it('treats a losing withdraw as already sent', () => {
    const settlement = settlementOf({
      staged: STAGED,
      events: eventsOf([
        {
          ...envelope(1),
          type: 'input-posted',
          inboxId: 1,
          kind: 'message',
          postedAt: '2026-11-08T20:00:01.000Z',
          message: { text: 'first', clientId: 'client-a' },
        },
        {
          ...envelope(2),
          type: 'input-refused',
          inboxId: 1,
          targetInboxId: 1,
          reason: 'already-sent',
        },
      ]),
    })
    expect(settlement.restored).toEqual([])
    expect(settlement.notices).toEqual(['Already sent'])
  })
})

describe('draftAfterSettlementOf', () => {
  it('puts the restored text ahead of whatever is in the composer', () => {
    expect(draftAfterSettlementOf({ restored: ['first'], draft: '' })).toBe('first')
    expect(draftAfterSettlementOf({ restored: ['first'], draft: 'next' })).toBe('first\n\nnext')
  })
})
