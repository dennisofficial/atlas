import { describe, expect, it } from 'bun:test'

import { popoverContentVariants } from '../popover'

describe('PopoverContent', () => {
  it('sm tightens the inset and the stack gap', () => {
    const classes = popoverContentVariants({ size: 'sm' }).split(' ')

    expect(classes).toContain('p-1.5')
    expect(classes).toContain('gap-1')
  })
})
