import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from '../../models/__tests__/subpath-walker'

describe('provider-oauth subpath guard', () => {
  it('reaches nothing but core from @dltech/atlas-harness/provider-oauth', () => {
    const entry = join(import.meta.dir, '..', 'index.ts')
    expect(subpathViolations({ entry, allowedPackages: ['@dltech/atlas-core'] })).toEqual([])
  })
})
