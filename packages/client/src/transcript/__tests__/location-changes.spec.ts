import { EExecutionLocation, ELocationChangeCause } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const kinds = (events: Parameters<typeof deriveTranscript>[0]['events']): EEntryKind[] =>
  deriveTranscript({ events, signals: [] }).entries.map((entry) => entry.kind)

describe('a session changing where it runs', () => {
  it('says nothing about the pod it was born in', () => {
    const bornCloud = log([
      { type: 'user-said', text: 'start in the cloud' },
      {
        type: 'location-changed',
        from: EExecutionLocation.Host,
        to: EExecutionLocation.Cloud,
        cwd: '/atlas/workspaces/repo',
      },
    ])

    expect(kinds(bornCloud)).toEqual([EEntryKind.OperatorSaid])
  })

  it('says nothing about a move between a cloud pod and a local one', () => {
    const moved = log([
      { type: 'user-said', text: 'take it up' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      { type: 'user-said', text: 'now back' },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
    ])

    expect(kinds(moved)).toEqual([EEntryKind.OperatorSaid])
  })

  it('says nothing when an expired sandbox moves the session back', () => {
    const expired = log([
      { type: 'user-said', text: 'work up there' },
      {
        type: 'location-changed',
        from: EExecutionLocation.Cloud,
        to: EExecutionLocation.Host,
        cause: ELocationChangeCause.SandboxExpired,
      },
    ])

    expect(kinds(expired)).toEqual([EEntryKind.OperatorSaid])
  })
})
