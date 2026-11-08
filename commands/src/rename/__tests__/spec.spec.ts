import { describe, expect, it } from 'bun:test'

import { rename, renameArgs } from '../spec'

describe('rename spec', () => {
  it('is handled in the control plane and has no inbox entry', () => {
    expect(rename.spec.name).toBe('rename')
    expect(rename.spec.handledIn).toBe('control')
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
