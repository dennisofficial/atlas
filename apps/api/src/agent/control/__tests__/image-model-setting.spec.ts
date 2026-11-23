import { describe, expect, it } from 'bun:test'

import { imageModelOf } from '../image-model-setting'

const KEY = 'images.model'

const setting = (value: string): string => `atlas-setting:v1:${JSON.stringify(value)}`

describe('imageModelOf', () => {
  it('answers nothing when the setting is unset', () => {
    expect(imageModelOf(new Map())).toBeUndefined()
  })

  it('reads the stored gateway id through the setting prefix', () => {
    const settings = new Map([[KEY, setting('microsoft/mai-image-2.7')]])

    expect(imageModelOf(settings)).toBe('microsoft/mai-image-2.7')
  })

  it('accepts a plain value written without the prefix', () => {
    expect(imageModelOf(new Map([[KEY, 'spacexai/grok-imagine-image-2.0']]))).toBe(
      'spacexai/grok-imagine-image-2.0',
    )
  })

  it('answers nothing for a model outside the Zero Data Retention list', () => {
    expect(imageModelOf(new Map([[KEY, setting('bfl/flux-kontext-pro')]]))).toBeUndefined()
  })

  it('answers nothing for a value that is not a string setting', () => {
    expect(imageModelOf(new Map([[KEY, 'atlas-setting:v1:{"model":"x"}']]))).toBeUndefined()
    expect(imageModelOf(new Map([[KEY, 'atlas-setting:v1:not-json']]))).toBeUndefined()
  })
})
