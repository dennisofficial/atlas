import { describe, expect, it } from 'bun:test'

import { bootStepErrorOf, EBootStepState, sandboxBootDisplayOf } from '../sandbox-boot-copy'

const { Pending, Running, Done, Error, Interrupted } = EBootStepState

describe('sandboxBootDisplayOf', () => {
  it('opens a running or restarting start and keeps a finished one closed', () => {
    expect(sandboxBootDisplayOf({ steps: [{ state: Running }], state: Running }).open).toBe(true)
    expect(sandboxBootDisplayOf({ steps: [{ state: Interrupted }], state: Interrupted }).open).toBe(
      true,
    )
    expect(sandboxBootDisplayOf({ steps: [{ state: Done }], state: Done }).open).toBe(false)
  })

  it('opens a finished start when a child step failed', () => {
    const display = sandboxBootDisplayOf({
      steps: [{ state: Done, children: [{ state: Error, detail: 'repository not found' }] }],
      state: Done,
    })
    expect(display.open).toBe(true)
    expect(display.failed).toBe(false)
  })

  it('lifts the error to the header only when no step carries it', () => {
    const bare = sandboxBootDisplayOf({ steps: [{ state: Error }], state: Error, error: 'boom' })
    expect(bare.headerError).toBe('boom')
    expect(bare.failed).toBe(true)
    const carried = sandboxBootDisplayOf({
      steps: [{ state: Error, detail: 'boom' }, { state: Pending }],
      state: Error,
      error: 'boom',
    })
    expect(carried.headerError).toBeUndefined()
  })

  it('prefers the given title and summarises with the elapsed time', () => {
    const display = sandboxBootDisplayOf({
      steps: [{ state: Done }, { state: Running }],
      state: Running,
      title: 'Setup script failed',
      elapsedMs: 2_500,
    })
    expect(display.title).toBe('Setup script failed')
    expect(display.summary).toBe('1/2, 2.5s')
  })
})

describe('bootStepErrorOf', () => {
  it('reads the detail of a failed step only', () => {
    expect(bootStepErrorOf({ state: Error, detail: 'boom' })).toBe('boom')
    expect(bootStepErrorOf({ state: Done, detail: 'Vercel, iad1' })).toBeUndefined()
  })
})
