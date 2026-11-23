import { describe, expect, it } from 'bun:test'

import { SHIPPED_DEFAULT_REF } from '@dltech/atlas-models'

import { DEFAULT_MODEL_REF } from '../config'

describe('default model ref', () => {
  it('stays the ref the harness composition falls back to', () => {
    expect(SHIPPED_DEFAULT_REF).toEqual(DEFAULT_MODEL_REF)
  })
})
