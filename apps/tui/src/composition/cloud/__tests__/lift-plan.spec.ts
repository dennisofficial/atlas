import { describe, expect, it } from 'bun:test'

import { liftRefusal } from '../lift-plan'

const SETTLED = {
  compacting: false,
}

describe('when a lift may happen', () => {
  it('allows a settled conversation with nothing running', () => {
    expect(liftRefusal(SETTLED)).toBeNull()
  })

  it('waits for a summary being written, which rewrites the log it would transfer', () => {
    expect(liftRefusal({ ...SETTLED, compacting: true })).toContain('summary')
  })
})
