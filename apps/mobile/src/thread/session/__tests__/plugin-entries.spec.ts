import { describe, expect, it } from 'bun:test'

import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { ERowKind } from '../../rows'
import { eventSchema } from '../registered-plugins'
import { modelOf, viewOf } from '../rows'
import { wisprSignInEvents } from './wispr-sign-in-events'

const snapshotOf = (raw: readonly unknown[]): SessionSnapshot => ({
  events: raw.map((event) => eventSchema.parse(event)),
  foldable: raw.map((event) => eventSchema.parse(event)),
  quickStops: [],
  pending: { pending: [] },
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  shells: {},
  connection: ESessionConnection.Live,
  error: undefined,
  skipped: 0,
  writerAhead: false,
  fromCache: false,
})

describe('plugin entries on mobile', () => {
  it('shows the MCP sign-in card from a real operator_mcp_sign_in call', () => {
    const snapshot = snapshotOf(wisprSignInEvents)
    const view = viewOf({ model: modelOf({ snapshot }), snapshot, now: Date.now() })
    expect(view.rows.find((row) => row.kind === ERowKind.SignIn)).toMatchObject({
      kind: ERowKind.SignIn,
      id: 'f6b04a4f-6776-4473-ada8-8f8615fd1c04:443',
      subject: 'wispr-flow',
      result: undefined,
    })
  })
})
