import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import { clientIdOfSend, draftAfterSettlementOf, settlementOf } from '../staged-send'
import { eventSchema } from '../registered-plugins'

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

const eventsOf = (events: readonly unknown[]) => events.map((event) => eventSchema.parse(event))

const STAGED = [{ clientId: 'client-a', text: 'first', attachments: [] }]

const NOT_OWNED: ReadonlySet<number> = new Set()

const OWNED = new Set([1])

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
    const settlement = settlementOf({ staged: STAGED, events: [], ownedInboxIds: NOT_OWNED })
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
      ownedInboxIds: NOT_OWNED,
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
      ownedInboxIds: NOT_OWNED,
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual([{ text: 'first', attachments: [] }])
    expect(settlement.notices).toEqual(['session is archived'])
  })

  it('settles a withdrawn message without putting the text back, because the withdraw did', () => {
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
      ownedInboxIds: OWNED,
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual([])
    expect(settlement.notices).toEqual([])
  })

  it('restores a discarded message with its attachment and no notice', () => {
    const shot: Attachment = {
      id: 'shot-1',
      name: 'shot.png',
      mediaType: 'image/png',
      size: 12,
      content: { store: EAttachmentStore.Inline, data: 'AAAA' },
    }
    const settlement = settlementOf({
      staged: [{ clientId: 'client-a', text: 'first', attachments: [shot] }],
      events: eventsOf([
        {
          ...envelope(1),
          type: 'input-posted',
          inboxId: 1,
          kind: 'message',
          postedAt: '2026-11-08T20:00:01.000Z',
          message: { text: 'first', clientId: 'client-a' },
        },
        { ...envelope(2), type: 'input-consumed', inboxId: 1, consumed: 'discarded' },
      ]),
      ownedInboxIds: NOT_OWNED,
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual([{ text: 'first', attachments: [shot] }])
    expect(settlement.notices).toEqual([])
  })

  it('keeps the staged copy while the posted message still waits in the queue', () => {
    const posted = eventsOf([
      { ...envelope(1), type: 'user-said', text: 'first', clientId: 'client-a' },
    ])
    const unread = settlementOf({
      staged: STAGED,
      events: posted,
      unread: new Set(['client-a']),
      ownedInboxIds: NOT_OWNED,
    })

    expect(unread.kept).toEqual(STAGED)
    expect(unread.restored).toEqual([])

    const consumed = eventsOf([
      { ...envelope(1), type: 'user-said', text: 'first', clientId: 'client-a' },
      { ...envelope(2), type: 'input-consumed', inboxId: 1, consumed: 'message' },
    ])

    expect(
      settlementOf({
        staged: STAGED,
        events: consumed,
        unread: new Set(),
        ownedInboxIds: NOT_OWNED,
      }).kept,
    ).toEqual([])
  })

  it('stays silent when the withdraw path owns the refusal of the same target', () => {
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
          type: 'input-consumed',
          inboxId: 1,
          consumed: 'message',
        },
        {
          ...envelope(3),
          type: 'input-refused',
          inboxId: 1,
          targetInboxId: 1,
          reason: 'already-sent',
        },
      ]),
      ownedInboxIds: OWNED,
    })
    expect(settlement.kept).toEqual([])
    expect(settlement.restored).toEqual([])
    expect(settlement.notices).toEqual([])
  })
})

describe('draftAfterSettlementOf', () => {
  it('puts the restored text ahead of whatever is in the composer', () => {
    expect(draftAfterSettlementOf({ restored: ['first'], draft: '' })).toBe('first')
    expect(draftAfterSettlementOf({ restored: ['first'], draft: 'next' })).toBe('first\n\nnext')
  })
})
