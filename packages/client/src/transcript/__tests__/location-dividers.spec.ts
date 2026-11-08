import { EExecutionLocation, ELocationChangeCause } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const dividerCount = (events: Parameters<typeof deriveTranscript>[0]['events']): number =>
  deriveTranscript({ events, signals: [] }).entries.filter(
    (entry) => entry.kind === EEntryKind.LocationChanged,
  ).length

describe('location dividers', () => {
  it('says nothing about a session that started in the cloud', () => {
    const bornCloud = log([
      { type: 'user-said', text: 'start in the cloud' },
      {
        type: 'location-changed',
        from: EExecutionLocation.Host,
        to: EExecutionLocation.Cloud,
        cwd: '/atlas/workspaces/repo',
      },
    ])

    expect(dividerCount(bornCloud)).toBe(0)
  })

  it('says nothing about a logged move to or from the cloud', () => {
    const up = log([
      { type: 'user-said', text: 'take it up' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
    ])
    const down = log([
      { type: 'user-said', text: 'bring it back' },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
    ])

    expect(dividerCount(up)).toBe(0)
    expect(dividerCount(down)).toBe(0)
  })

  it('keeps a genuine host-to-docker move', () => {
    const moved = log([
      { type: 'user-said', text: 'run this in docker' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Docker },
    ])

    expect(dividerCount(moved)).toBe(1)
  })

  it('keeps a genuine docker-to-host move', () => {
    const moved = log([
      { type: 'location-changed', from: EExecutionLocation.Docker, to: EExecutionLocation.Host },
    ])

    expect(dividerCount(moved)).toBe(1)
  })

  it('keeps a sandbox-expiry move out of the cloud', () => {
    const expired = log([
      {
        type: 'location-changed',
        from: EExecutionLocation.Cloud,
        to: EExecutionLocation.Host,
        cause: ELocationChangeCause.SandboxExpired,
      },
    ])

    expect(dividerCount(expired)).toBe(1)
  })
})
