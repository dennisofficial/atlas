import { PayloadTooLargeException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { MAX_CONTEXT_BUNDLE_BYTES } from '../../platform/sandboxes/workspace-spec'
import { assertArchiveWithinLimit, MAX_CONTEXT_ARCHIVE_BYTES } from './context-archive-limits'

describe('assertArchiveWithinLimit', () => {
  it('accepts a byte count at or under the archive cap', () => {
    expect(() => assertArchiveWithinLimit({ bytes: MAX_CONTEXT_ARCHIVE_BYTES })).not.toThrow()
    expect(() => assertArchiveWithinLimit({ bytes: 0 })).not.toThrow()
  })

  it('rejects a byte count over the archive cap with a friendly 413', () => {
    expect(() =>
      assertArchiveWithinLimit({ bytes: MAX_CONTEXT_ARCHIVE_BYTES + 1 }),
    ).toThrow(PayloadTooLargeException)
  })

  it('sets the archive cap well above the legacy JSON bundle cap', () => {
    expect(MAX_CONTEXT_ARCHIVE_BYTES).toBeGreaterThan(MAX_CONTEXT_BUNDLE_BYTES)
  })
})
