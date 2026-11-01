import { describe, expect, it } from 'bun:test'

import { DEFAULT_MODEL_REF } from '../../composition/config'
import { defaultModelId, SHIPPED_DEFAULT_REF } from '../default-selection'

const offered = (...entries: [id: string, reachable: boolean][]) =>
  entries.map(([id, reachable]) => ({ id, reachable }))

const SHIPPED = 'anthropic/claude-haiku-4-5'

describe('defaultModelId', () => {
  it('ships the haiku default the harness falls back to', () => {
    expect(SHIPPED_DEFAULT_REF).toEqual({ providerId: 'anthropic', modelId: 'claude-haiku-4-5' })
  })

  it('stays the ref the harness composition falls back to', () => {
    expect(SHIPPED_DEFAULT_REF).toEqual(DEFAULT_MODEL_REF)
  })

  it('prefers the personal default when it is reachable', () => {
    const models = offered([SHIPPED, true], ['openai/gpt-5', true])
    expect(defaultModelId({ offered: models, personalId: 'openai/gpt-5' })).toBe('openai/gpt-5')
  })

  it('skips a personal default that is not reachable and takes the shipped default', () => {
    const models = offered(['openai/gpt-5', false], ['openai/o3', true], [SHIPPED, true])
    expect(defaultModelId({ offered: models, personalId: 'openai/gpt-5' })).toBe(SHIPPED)
  })

  it('takes the shipped default when there is no personal default', () => {
    const models = offered(['openai/gpt-5', true], [SHIPPED, true])
    expect(defaultModelId({ offered: models, personalId: '' })).toBe(SHIPPED)
  })

  it('takes the first reachable option when the shipped default is not reachable', () => {
    const models = offered(
      [SHIPPED, false],
      ['openai/gpt-5', false],
      ['openrouter/vendor/a', true],
      ['openrouter/vendor/b', true],
    )
    expect(defaultModelId({ offered: models, personalId: 'nope/none' })).toBe('openrouter/vendor/a')
  })

  it('answers nothing when no option is reachable or none is offered', () => {
    expect(defaultModelId({ offered: offered([SHIPPED, false]), personalId: SHIPPED })).toBe(
      undefined,
    )
    expect(defaultModelId({ offered: [], personalId: '' })).toBe(undefined)
  })
})
