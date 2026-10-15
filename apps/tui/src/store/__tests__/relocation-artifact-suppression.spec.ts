import { EExecutionLocation, ELocationChangeCause } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { durableEntries } from '../durable-entries'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const entriesOf = (events: Parameters<typeof durableEntries>[0]['events']) =>
  durableEntries({ events })

const dividerCount = (events: Parameters<typeof durableEntries>[0]['events']): number =>
  deriveTranscript({ events, signals: [] }).entries.filter(
    (entry) => entry.kind === EEntryKind.LocationChanged,
  ).length

describe('born-placed relocation artifacts in old logs', () => {
  it('suppresses a logged move between host and cloud', () => {
    const lifted = log([
      { type: 'user-said', text: 'take it up' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      { type: 'user-said', text: 'keep it going from up there' },
    ])

    expect(dividerCount(lifted)).toBe(0)
  })

  it('suppresses a logged born-cloud birth arrival', () => {
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

  it('suppresses a logged relocation of a thread already in the cloud', () => {
    const refiled = log([
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Cloud },
    ])

    expect(dividerCount(refiled)).toBe(0)
  })
})

describe('legacy session-relocation context injections', () => {
  const relocationInjection = {
    type: 'context-loaded',
    slot: 'session',
    key: 'execution-location',
    content: 'Your environment is now cloud. Your project directory is /atlas/workspaces/repo.',
  } as const

  it('drops a logged session-slot execution-location injection from the transcript', () => {
    const entries = entriesOf(
      log([{ type: 'user-said', text: 'hello' }, relocationInjection]),
    )

    expect(entries.filter((entry) => entry.kind === EEntryKind.SystemContext)).toHaveLength(0)
  })

  it('keeps a session-slot injection under a different key', () => {
    const entries = entriesOf(
      log([
        {
          type: 'context-loaded',
          slot: 'session',
          key: 'something-else',
          content: 'some other session-scoped note',
        },
      ]),
    )

    const contexts = entries.filter((entry) => entry.kind === EEntryKind.SystemContext)
    expect(contexts).toHaveLength(1)
  })
})
