import { describe, expect, it } from 'bun:test'

import { radioGroupVariants } from '../radio-group'

describe('RadioGroup', () => {
  it('rows stacks its options edge to edge with dividers', () => {
    const classes = radioGroupVariants({ layout: 'rows' }).split(' ')

    expect(classes).toContain('gap-0')
    expect(classes).toContain('divide-y')
  })
})
