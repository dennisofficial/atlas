import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from './subpath-walker'

const ALLOWED = ['@dltech/atlas-core', 'zod']
const ENTRIES = {
  '@dltech/atlas-credentials': join(import.meta.dir, '..', 'index.ts'),
  '@dltech/atlas-credentials/provider-oauth': join(
    import.meta.dir,
    '..',
    'provider-oauth',
    'index.ts',
  ),
}

describe('credentials purity guard', () => {
  for (const [name, entry] of Object.entries(ENTRIES)) {
    it(`reaches nothing but core and zod from ${name}`, () => {
      expect(subpathViolations({ entry, allowedPackages: ALLOWED })).toEqual([])
    })
  }
})
