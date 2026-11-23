import { describe, expect, it } from 'bun:test'
import { ECommandRunsIn } from '@dltech/atlas-commands'

import { REFUSAL_RENAME_NEEDS_NAME, rename, renameArgs } from '../spec'

describe('rename spec', () => {
  it('runs in the control plane and has no inbox entry', () => {
    expect(rename.spec.name).toBe('rename')
    expect(rename.spec.runsIn).toBe(ECommandRunsIn.Control)
    expect(rename.spec.argumentHint).toBe('<name>')
  })

  it('trims the name', () => {
    expect(renameArgs.parse({ name: '  Fix login  ' })).toEqual({ name: 'Fix login' })
  })

  it.each([{ name: '   ' }, { name: '' }, { name: 'x'.repeat(201) }, {}, { name: 'a', extra: 1 }])(
    'refuses %p',
    (args) => {
      expect(renameArgs.safeParse(args).success).toBe(false)
    },
  )
})

describe('rename fromText', () => {
  it('reads the argument text as the name', () => {
    expect(rename.spec.fromText?.('Fix login')).toEqual({ ok: true, args: { name: 'Fix login' } })
  })

  it('refuses an empty argument text with its own sentence', () => {
    expect(rename.spec.fromText?.('')).toEqual({
      ok: false,
      reason: REFUSAL_RENAME_NEEDS_NAME,
    })
  })
})
