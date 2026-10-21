import { describe, expect, it } from 'vitest'

import { birthRefusal } from '../birth-refusal'

const SETTLED = {
  compacting: false,
  rotating: false,
}

describe('when a cloud birth may happen', () => {
  it('allows a settled conversation with nothing running', () => {
    expect(birthRefusal(SETTLED)).toBeNull()
  })

  it('waits for a summary being written, which rewrites the log it would carry over', () => {
    expect(birthRefusal({ ...SETTLED, compacting: true })).toContain('summary')
  })

  it('waits for a rotation, which rewrites the log the birth would carry over', () => {
    expect(birthRefusal({ ...SETTLED, rotating: true })).toContain('rotation')
  })
})
