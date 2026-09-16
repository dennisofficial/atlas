import { describe, expect, it } from 'bun:test'

import { liftRefusal } from '../lift-plan'

const SETTLED = {
  working: false,
  interrupting: false,
  compacting: false,
  runningAgents: 0,
}

describe('when a lift may happen', () => {
  it('allows a settled conversation with nothing running', () => {
    expect(liftRefusal(SETTLED)).toBeNull()
  })

  it('waits for a turn in flight', () => {
    expect(liftRefusal({ ...SETTLED, working: true })).toContain('settle')
  })

  it('waits for an interrupt to land', () => {
    expect(liftRefusal({ ...SETTLED, interrupting: true })).toContain('settle')
  })

  it('waits for a summary being written, which rewrites the log it would transfer', () => {
    expect(liftRefusal({ ...SETTLED, compacting: true })).toContain('summary')
  })

  it('refuses while a sub-agent is running, and says why', () => {
    const refusal = liftRefusal({ ...SETTLED, runningAgents: 1 })

    expect(refusal).toContain('sub-agent is')
    expect(refusal).toContain('stay on this machine')
  })

  it('counts the sub-agents it is waiting on', () => {
    expect(liftRefusal({ ...SETTLED, runningAgents: 3 })).toContain('3 sub-agents are')
  })
})
