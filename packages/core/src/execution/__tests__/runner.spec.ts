import { describe, expect, it } from 'vitest'

import { ERunner, runnerOf } from '../runner'

describe('a runner named as text', () => {
  it('reads the values the thread meta holds', () => {
    expect(runnerOf('local')).toBe(ERunner.Local)
    expect(runnerOf('vercel')).toBe(ERunner.Vercel)
  })

  it('reads nothing into no decision, so a thread born before runners stays undecided', () => {
    expect(runnerOf(null)).toBeUndefined()
    expect(runnerOf(undefined)).toBeUndefined()
    expect(runnerOf('')).toBeUndefined()
  })

  it('refuses a value Atlas never wrote rather than guessing at one', () => {
    expect(runnerOf('docker')).toBeUndefined()
    expect(runnerOf('LOCAL')).toBeUndefined()
  })
})
