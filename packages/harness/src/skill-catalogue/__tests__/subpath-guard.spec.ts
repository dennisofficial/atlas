import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from '../../models/__tests__/subpath-walker'

const CATALOGUE_ENTRY = join(import.meta.dir, '..', 'index.ts')

describe('skill-catalogue subpath guard', () => {
  it('finds nothing forbidden reachable from @dltech/atlas-harness/skill-catalogue', () => {
    expect(
      subpathViolations({ entry: CATALOGUE_ENTRY, allowedPackages: ['@dltech/atlas-core'] }),
    ).toEqual([])
  })
})
