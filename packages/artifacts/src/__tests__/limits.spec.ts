import { describe, expect, it } from 'bun:test'

import {
  exceededBy,
  MAX_BYTES_PER_USER,
  MAX_BYTES_PER_VERSION,
  MAX_FILES_PER_VERSION,
} from '../limits'
import type { ManifestEntry } from '../manifest'

const entryOf = (size: number): ManifestEntry => ({
  path: `file-${size}.bin`,
  tree: 'dist',
  sha256: 'a'.repeat(64),
  size,
  type: 'application/octet-stream',
})

const entriesOf = ({ count, size }: { count: number; size: number }): ManifestEntry[] =>
  Array.from({ length: count }, (_, index) => ({ ...entryOf(size), path: `file-${index}.bin` }))

describe('limits', () => {
  it('exposes the documented caps', () => {
    expect(MAX_BYTES_PER_VERSION).toBe(26214400)
    expect(MAX_FILES_PER_VERSION).toBe(2000)
    expect(MAX_BYTES_PER_USER).toBe(524288000)
  })
})

describe('exceededBy', () => {
  it('accepts an empty version', () => {
    expect(exceededBy([])).toBeNull()
  })

  it('accepts a version at exactly the caps', () => {
    expect(exceededBy(entriesOf({ count: MAX_FILES_PER_VERSION, size: 1 }))).toBeNull()
  })

  it('rejects one file over the cap', () => {
    expect(exceededBy(entriesOf({ count: MAX_FILES_PER_VERSION + 1, size: 1 }))).toEqual({
      reason: `files ${MAX_FILES_PER_VERSION + 1} exceeds ${MAX_FILES_PER_VERSION}`,
    })
  })

  it('accepts exactly the byte cap', () => {
    expect(exceededBy([entryOf(MAX_BYTES_PER_VERSION)])).toBeNull()
  })

  it('rejects a byte over the cap', () => {
    expect(exceededBy([entryOf(MAX_BYTES_PER_VERSION + 1)])).toEqual({
      reason: `bytes ${MAX_BYTES_PER_VERSION + 1} exceeds ${MAX_BYTES_PER_VERSION}`,
    })
  })

  it('reports the file count before the byte total', () => {
    const entries = entriesOf({ count: MAX_FILES_PER_VERSION + 1, size: MAX_BYTES_PER_VERSION })
    expect(exceededBy(entries)?.reason).toBe(
      `files ${MAX_FILES_PER_VERSION + 1} exceeds ${MAX_FILES_PER_VERSION}`,
    )
  })
})
