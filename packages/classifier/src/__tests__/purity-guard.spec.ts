import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { subpathViolations } from './subpath-walker'

const ALLOWED = ['@dltech/atlas-core', 'zod']

describe('classifier purity guard', () => {
  it('reaches nothing but core and zod from @dltech/atlas-classifier', () => {
    const entry = join(import.meta.dir, '..', 'index.ts')
    expect(subpathViolations({ entry, allowedPackages: ALLOWED })).toEqual([])
  })
})
