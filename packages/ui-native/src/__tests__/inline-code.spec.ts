import { describe, expect, it } from 'bun:test'

import { inlineCodeTextOf } from '../markdown/inline-code-text'

describe('inlineCodeTextOf', () => {
  it('pads inline code with thin spaces, since iOS ignores padding on a nested span', () => {
    expect(inlineCodeTextOf('setup.sh')).toBe('\u2009setup.sh\u2009')
  })
})
