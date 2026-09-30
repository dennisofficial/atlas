import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const cloudMarkers = (
  events: Parameters<typeof deriveTranscript>[0]['events'],
  location: EExecutionLocation | undefined,
) =>
  deriveTranscript({ events, signals: [], location }).entries.filter(
    (entry) => entry.kind === EEntryKind.LocationChanged && entry.to === EExecutionLocation.Cloud,
  )

describe('the cloud line on a lift after a descend', () => {
  it('derives from current placement, not from an event the archive does not carry', () => {
    // The local log of a thread that lifted, came home, and said one more thing: the descend's
    // marker is the last location event it holds.
    const descendedLog = log([
      { type: 'user-said', text: 'get it running' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      { type: 'user-said', text: 'keep it going from up there' },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
      { type: 'user-said', text: 'back up it goes' },
    ])

    // The re-lift ships this exact log up; the cloud copy ends here — the lift's own marker lands
    // locally only after the archive sealed. The thread is genuinely in the cloud, and the
    // transcript the operator reads is this one.
    const cloudTranscript = descendedLog

    expect(cloudMarkers(cloudTranscript, EExecutionLocation.Cloud)).toHaveLength(1)
  })

  it('does not synthesize a marker while the session is home', () => {
    const home = log([
      { type: 'user-said', text: 'still here' },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
    ])

    expect(cloudMarkers(home, EExecutionLocation.Host)).toHaveLength(0)
  })
})
