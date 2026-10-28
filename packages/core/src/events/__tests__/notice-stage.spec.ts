import { describe, expect, it } from 'bun:test'

import { isTurnTaking } from '../../agents/kind'
import { log } from '../../assembly/__tests__/log-fixture'
import type { EventDraft } from '../body'
import {
  arrivedDraft,
  deliveredDraft,
  deliveredDraftOf,
  ENoticeStage,
  isNoticeArrival,
  isNoticeDelivery,
  owedNotices,
  reachesModel,
  recordsLifecycle,
} from '../notice-stage'
import { awaitsReply } from '../projections'
import { eventBodySchema } from '../schema'
import {
  agentEnded,
  agentReported,
  arrived,
  delivered,
  serviceEnded,
  shellEnded,
} from './notice-fixture'

const said: EventDraft = { type: 'user-said', text: 'go' }
const spoke: EventDraft = {
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'ok' }],
}

describe('classifying a notice row by stage', () => {
  it('treats a row with no stamp as legacy: model-visible and a lifecycle record', () => {
    const legacy = agentEnded()

    expect(isNoticeArrival(legacy)).toBe(false)
    expect(isNoticeDelivery(legacy)).toBe(false)
    expect(reachesModel(legacy)).toBe(true)
    expect(recordsLifecycle(legacy)).toBe(true)
  })

  it('keeps an arrival from the model but records its lifecycle', () => {
    const row = arrived(shellEnded)

    expect(isNoticeArrival(row)).toBe(true)
    expect(reachesModel(row)).toBe(false)
    expect(recordsLifecycle(row)).toBe(true)
  })

  it('shows a delivery to the model but leaves its lifecycle to the arrival', () => {
    const row = delivered(shellEnded)

    expect(isNoticeDelivery(row)).toBe(true)
    expect(reachesModel(row)).toBe(true)
    expect(recordsLifecycle(row)).toBe(false)
  })

  it('never shows a bookkeeping ending to the model', () => {
    expect(reachesModel(agentEnded({ relayed: false }))).toBe(false)
    expect(recordsLifecycle(agentEnded({ relayed: false }))).toBe(true)
  })

  it('leaves a type that carries no notice untouched when stamping', () => {
    expect(arrivedDraft({ draft: said, id: 'n' })).toEqual(said)
  })
})

describe('owedNotices', () => {
  it('lists an arrival no delivery has answered, in log order', () => {
    const events = log([
      said,
      arrived(shellEnded, 'a'),
      arrived(serviceEnded, 'b'),
      arrived(agentReported, 'c'),
    ])

    expect(owedNotices(events).map((event) => event.seq)).toEqual([2, 3, 4])
  })

  it('drops an arrival once a delivery of the same id exists', () => {
    const events = log([
      arrived(shellEnded, 'a'),
      arrived(serviceEnded, 'b'),
      delivered(shellEnded, 'a'),
    ])

    expect(owedNotices(events).map((event) => event.seq)).toEqual([2])
  })

  it('ignores legacy rows', () => {
    expect(owedNotices(log([said, shellEnded, agentEnded()]))).toEqual([])
  })

  it('never owes a bookkeeping ending', () => {
    const events = log([arrived(agentEnded({ relayed: false }), 'a')])

    expect(owedNotices(events)).toEqual([])
  })
})

describe('deliveredDraftOf', () => {
  it('rebuilds the arrival as a delivery without its envelope', () => {
    const [arrival] = log([arrived(agentEnded(), 'n-9')])
    if (arrival === undefined) throw new Error('no arrival')

    const draft = deliveredDraftOf(arrival)

    expect(draft).toEqual(deliveredDraft({ draft: agentEnded(), id: 'n-9' }))
    expect(draft).toMatchObject({ notice: { id: 'n-9', stage: ENoticeStage.Delivered } })
    expect(draft).not.toHaveProperty('seq')
    expect(draft).not.toHaveProperty('threadId')
    expect(draft).not.toHaveProperty('at')
  })

  it('refuses a legacy row and a delivery', () => {
    const [legacy, delivery] = log([shellEnded, delivered(shellEnded)])
    if (legacy === undefined || delivery === undefined) throw new Error('no rows')

    expect(deliveredDraftOf(legacy)).toBeUndefined()
    expect(deliveredDraftOf(delivery)).toBeUndefined()
  })

  it('matches what the stampers produce', () => {
    const [arrival] = log([arrivedDraft({ draft: serviceEnded, id: 'x' })])
    if (arrival === undefined) throw new Error('no arrival')

    expect(deliveredDraftOf(arrival)).toEqual(deliveredDraft({ draft: serviceEnded, id: 'x' }))
  })
})

describe('whose turn an arrival or delivery makes it', () => {
  it('never hands the turn over for an arrival, whatever the type', () => {
    for (const draft of [agentEnded(), agentReported, shellEnded, serviceEnded]) {
      expect(isTurnTaking(arrived(draft))).toBe(false)
    }
  })

  it('hands the turn over for a delivery as it would for a legacy row', () => {
    for (const draft of [agentEnded(), agentReported, shellEnded, serviceEnded]) {
      expect(isTurnTaking(delivered(draft))).toBe(isTurnTaking(draft))
    }
  })

  it('does not await a reply for an assistant reply followed by an arrival', () => {
    expect(awaitsReply(log([said, spoke, arrived(shellEnded)]))).toBe(false)
  })

  it('awaits a reply for an assistant reply followed by a delivery', () => {
    expect(awaitsReply(log([said, spoke, delivered(shellEnded)]))).toBe(true)
  })
})

describe('the notice stamp on the wire', () => {
  it('round-trips through the body schema', () => {
    const row = arrived(serviceEnded)

    expect(eventBodySchema.parse(row)).toEqual(row)
  })

  it('rejects an unknown stage and an empty id', () => {
    expect(
      eventBodySchema.safeParse({
        ...shellEnded,
        notice: { id: 'n', stage: 'later' },
      }).success,
    ).toBe(false)
    expect(
      eventBodySchema.safeParse({
        ...shellEnded,
        notice: { id: '', stage: 'arrived' },
      }).success,
    ).toBe(false)
  })

  it('still parses a legacy row', () => {
    expect(eventBodySchema.safeParse(shellEnded).success).toBe(true)
  })
})
