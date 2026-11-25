import { describe, expect, test } from 'bun:test'

import { EMessageOrigin, pendingInputsOf, type RecordEventBody } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { EPendingKind, type PendingRow } from '../../store'
import { pendingRowsOf } from '../pending-rows'
import type { StagedMessage } from '../staged-messages'

const EMPTY = pendingInputsOf([])

const staged = (clientId: string, text: string): StagedMessage => ({
  clientId,
  text,
  attachments: [],
})

const posted = (args: {
  inboxId: number
  text: string
  clientId?: string
  via?: EMessageOrigin
}): RecordEventBody => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: 'message',
  postedAt: '2026-11-20T00:00:00.000Z',
  message: {
    text: args.text,
    ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
    ...(args.via === undefined ? {} : { via: args.via }),
  },
})

const rowsOf = (args: {
  bodies?: readonly RecordEventBody[]
  staged?: readonly StagedMessage[]
  refused?: readonly StagedMessage[]
  hiddenInboxIds?: ReadonlySet<number>
}): readonly PendingRow[] =>
  pendingRowsOf({
    pending:
      args.bodies === undefined ? EMPTY : pendingInputsOf(mintEvents({ bodies: args.bodies })),
    staged: args.staged ?? [],
    refused: args.refused ?? [],
    working: true,
    ...(args.hiddenInboxIds === undefined ? {} : { hiddenInboxIds: args.hiddenInboxIds }),
  })

describe('pendingRowsOf', () => {
  test('paints a staged row, then the queue the server reports', () => {
    const rows = rowsOf({
      bodies: [posted({ inboxId: 7, text: 'queued while it works' })],
      staged: [staged('c1', 'hello')],
    })

    expect(rows).toEqual([
      { kind: EPendingKind.Sending, id: 'c1', text: 'hello', failed: false },
      { kind: EPendingKind.Operator, id: '7', text: 'queued while it works' },
    ])
  })

  test('drops a queued message whose clientId a staged row already shows', () => {
    const rows = rowsOf({
      bodies: [posted({ inboxId: 7, text: 'hello', clientId: 'c1' })],
      staged: [staged('c1', 'hello')],
    })

    expect(rows.map((row) => row.id)).toEqual(['c1'])
  })

  test('drops a staged row whose posted inbox a take-back hid', () => {
    const rows = rowsOf({
      bodies: [posted({ inboxId: 7, text: 'hello', clientId: 'c1' })],
      staged: [staged('c1', 'hello')],
      hiddenInboxIds: new Set([7]),
    })

    expect(rows).toEqual([])
  })

  test('keeps a staged row no take-back hid', () => {
    const rows = rowsOf({
      bodies: [posted({ inboxId: 7, text: 'hello', clientId: 'c1' })],
      staged: [staged('c1', 'hello')],
      hiddenInboxIds: new Set([8]),
    })

    expect(rows.map((row) => row.id)).toEqual(['c1'])
  })

  test('a message from another sender is not editable', () => {
    const rows = rowsOf({
      bodies: [posted({ inboxId: 7, text: 'from the model', via: EMessageOrigin.Routine })],
    })

    expect(rows).toEqual([
      { kind: EPendingKind.Operator, id: '7', text: 'from the model', editable: false },
    ])
  })

  test('a refused attempt paints a failed sending row', () => {
    const rows = rowsOf({ refused: [staged('c1', 'hello')] })

    expect(rows).toEqual([{ kind: EPendingKind.Sending, id: 'c1', text: 'hello', failed: true }])
  })

  test('says nothing when nothing is queued', () => {
    expect(rowsOf({})).toEqual([])
  })
})
