import { describe, expect, it } from 'bun:test'

import { ServicesFragment } from '../fragment'

const textOf = () => new ServicesFragment().text()

describe('ServicesFragment', () => {
  it('keeps the lifecycle description of the service tool', () => {
    expect(textOf()).toContain('`service` with action `start` runs a long-running service')
  })

  it('tells the agent to start a long-running process by declared name', () => {
    const text = textOf()
    expect(text).toContain('.atlas/services.yaml')
    expect(text).toContain('`service` action `start` and `name`')
    expect(text).toContain('instead of running it ad hoc')
  })

  it('allows a command only for a one-off', () => {
    expect(textOf()).toContain('`command` only for a one-off')
  })

  it('forbids holding a server alive from bash', () => {
    const text = textOf()
    expect(text).toContain('nohup')
    expect(text).toContain('runInBackground')
    expect(text).toContain('timeoutMs')
    expect(text).toContain('Never keep a server alive')
  })
})
