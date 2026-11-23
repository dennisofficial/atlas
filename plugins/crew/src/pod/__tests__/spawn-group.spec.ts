import { describe, expect, it } from 'bun:test'

import { spawnsInStepOf, spawnStepKeyOf } from '../spawn-group'
import { eventLog } from './crew-tools-rig'

describe('spawnsInStepOf', () => {
  it('counts a lone spawn as one', () => {
    const log = eventLog()
    const events = [log.said(), log.called({ name: 'agent_spawn', ordinal: 0 })]

    expect(spawnsInStepOf(events)).toBe(1)
  })

  it('counts the three spawns of one step', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
      log.called({ name: 'agent_spawn', ordinal: 1 }),
      log.called({ name: 'agent_spawn', ordinal: 2 }),
    ]

    expect(spawnsInStepOf(events)).toBe(3)
  })

  it('counts only the spawns of the latest step', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
      log.called({ name: 'agent_spawn', ordinal: 1 }),
      log.resulted({ name: 'agent_spawn' }),
      log.resulted({ name: 'agent_spawn' }),
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
    ]

    expect(spawnsInStepOf(events)).toBe(1)
  })

  it('counts a spawn among other tools of the same step', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'read', ordinal: 0 }),
      log.called({ name: 'agent_spawn', ordinal: 1 }),
      log.called({ name: 'grep', ordinal: 2 }),
      log.called({ name: 'agent_spawn', ordinal: 3 }),
    ]

    expect(spawnsInStepOf(events)).toBe(2)
  })

  it('counts no spawn when the log holds only other tools', () => {
    const log = eventLog()
    const events = [log.said(), log.called({ name: 'read', ordinal: 0 })]

    expect(spawnsInStepOf(events)).toBe(0)
  })
})

describe('spawnStepKeyOf', () => {
  it('names the step by the call id of its first tool call', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
      log.called({ name: 'agent_spawn', ordinal: 1 }),
    ]

    expect(spawnStepKeyOf(events)).toBe('call-2')
  })

  it('takes the first call of the step, even when it is not a spawn', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'read', ordinal: 0 }),
      log.called({ name: 'agent_spawn', ordinal: 1 }),
    ]

    expect(spawnStepKeyOf(events)).toBe('call-2')
  })

  it('names the latest step, not the first one in the log', () => {
    const log = eventLog()
    const events = [
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
      log.resulted({ name: 'agent_spawn' }),
      log.said(),
      log.called({ name: 'agent_spawn', ordinal: 0 }),
    ]

    expect(spawnStepKeyOf(events)).toBe('call-5')
  })

  it('names no step when the log holds no tool call', () => {
    const log = eventLog()

    expect(spawnStepKeyOf([log.said()])).toBeUndefined()
  })
})
