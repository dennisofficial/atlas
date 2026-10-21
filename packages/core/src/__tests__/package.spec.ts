import { describe, expect, it } from 'vitest'

import { CORE_PACKAGE_NAME } from '../index'

describe('@dltech/atlas-core', () => {
  it('resolves and imports', () => {
    expect(CORE_PACKAGE_NAME).toBe('@dltech/atlas-core')
  })
})
