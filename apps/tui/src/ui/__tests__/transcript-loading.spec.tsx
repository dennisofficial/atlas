import { describe, expect, it } from 'bun:test'

import {
  LOADING_TRANSCRIPT_LABEL,
  TranscriptLoading,
  transcriptLoading,
} from '../components/transcript-loading'
import { grammarsReady } from '../markdown/__tests__/harness'
import { frameOf } from './transcript-fixture'

await grammarsReady()

const parked = {
  welcome: true,
  bootingCloudThread: true,
  attachFailed: false,
  firstReadLanded: false,
}

describe('the loading state of a parked cloud thread', () => {
  it('shows from boot until the first read lands', () => {
    expect(transcriptLoading(parked)).toBe(true)
    expect(transcriptLoading({ ...parked, firstReadLanded: true })).toBe(false)
  })

  it('never shows for a thread that is not a booting cloud thread, or after the attach failed', () => {
    expect(transcriptLoading({ ...parked, bootingCloudThread: false })).toBe(false)
    expect(transcriptLoading({ ...parked, welcome: false })).toBe(false)
    expect(transcriptLoading({ ...parked, attachFailed: true })).toBe(false)
  })

  it('draws a visible line in the transcript area instead of a blank screen', async () => {
    const frame = await frameOf(<TranscriptLoading />, 60)

    expect(frame).toContain(LOADING_TRANSCRIPT_LABEL)
  })
})
