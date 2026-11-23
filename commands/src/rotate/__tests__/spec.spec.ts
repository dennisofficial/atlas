import { describe, expect, it } from 'bun:test'
import { ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'

import { REFUSAL_ROTATE_CHILDREN, rotate, rotateArgs } from '../spec'

const fromText = (argumentText: string): TextArgs => {
  const parse = rotate.spec.fromText
  if (parse === undefined) throw new Error('rotate declares fromText')
  return parse(argumentText)
}

describe('rotate fromText', () => {
  it('takes an empty line as no instructions', () => {
    expect(fromText('')).toEqual({ ok: true, args: {} })
  })

  it('trims the whole argument text into the instructions', () => {
    expect(fromText('  ship the migration first  ')).toEqual({
      ok: true,
      args: { instructions: 'ship the migration first' },
    })
  })

  it('hints the optional instructions argument', () => {
    expect(rotate.spec.argumentHint).toBe('[instructions]')
  })

  it('runs in the host as a context command', () => {
    expect(rotate.spec.name).toBe('rotate')
    expect(rotate.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(rotate.spec.group).toBe(ECommandGroup.Context)
  })

  it('uses the pinned refusal sentence', () => {
    expect(REFUSAL_ROTATE_CHILDREN).toBe('A sub-agent is still running; stop it first.')
  })
})

describe('rotateArgs', () => {
  it.each([
    { instructions: 'x'.repeat(2001) },
    { instructions: 7 },
    { instructions: 'x', extra: 1 },
  ])('refuses %p', (value) => {
    expect(rotateArgs.safeParse(value).success).toBe(false)
  })

  it('accepts absent instructions and a string up to the limit', () => {
    expect(rotateArgs.safeParse({}).success).toBe(true)
    expect(rotateArgs.safeParse({ instructions: 'ship it' }).success).toBe(true)
    expect(rotateArgs.safeParse({ instructions: 'x'.repeat(2000) }).success).toBe(true)
  })
})
