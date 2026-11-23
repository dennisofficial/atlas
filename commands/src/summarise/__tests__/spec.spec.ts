import { describe, expect, it } from 'bun:test'
import type { TextArgs } from '@dltech/atlas-commands'

import { REFUSAL_SUMMARISE_ARGS, summarise, summariseArgs } from '../spec'

const fromText = (argumentText: string): TextArgs => {
  const parse = summarise.spec.fromText
  if (parse === undefined) throw new Error('summarise declares fromText')
  return parse(argumentText)
}

describe('summarise fromText', () => {
  it('takes an empty line as the default target', () => {
    expect(fromText('')).toEqual({ ok: true, args: {} })
  })

  it('reads a positive integer as the target sequence', () => {
    expect(fromText('4')).toEqual({ ok: true, args: { throughSeq: 4 } })
  })

  it.each(['x', '0', '-2', '2.5', '2 3'])('refuses %p with the usage sentence', (text) => {
    expect(fromText(text)).toEqual({ ok: false, reason: REFUSAL_SUMMARISE_ARGS })
  })

  it('hints the optional message argument', () => {
    expect(summarise.spec.argumentHint).toBe('[message]')
  })

  it('uses the pinned usage sentence', () => {
    expect(REFUSAL_SUMMARISE_ARGS).toBe('Use /summarise, or /summarise <seq>')
  })
})

describe('summariseArgs', () => {
  it.each([
    { throughSeq: 0 },
    { throughSeq: 1.5 },
    { throughSeq: '2' },
    { throughSeq: 2, extra: 1 },
  ])('refuses %p', (value) => {
    expect(summariseArgs.safeParse(value).success).toBe(false)
  })

  it('accepts an absent target and a positive integer', () => {
    expect(summariseArgs.safeParse({}).success).toBe(true)
    expect(summariseArgs.safeParse({ throughSeq: 2 }).success).toBe(true)
  })
})
