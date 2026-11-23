import { describe, expect, it } from 'bun:test'

import { safeFailureMessage } from '../safe-failure-message'

const OPENAI_REFUSAL =
  'Incorrect API key provided: sk-livec*********************0000. You can find your API key at https://platform.openai.com/account/api-keys.'

describe('safeFailureMessage', () => {
  it('redacts a masked key the provider quotes back', () => {
    const message = safeFailureMessage(OPENAI_REFUSAL)

    expect(message).not.toContain('sk-livec')
    expect(message).not.toContain('*')
    expect(message).toContain('Incorrect API key provided: [redacted].')
  })

  it('redacts masked keys of every known prefix', () => {
    for (const token of [
      'sk-ant-api03-****************abcd',
      'sk-proj-****************abcd',
      'xai-****************abcd',
      'gsk_****************abcd',
      'sk-••••••••••1234',
      'sk-...1234',
    ]) {
      expect(safeFailureMessage(`refused ${token} now`)).toBe('refused [redacted] now')
    }
  })

  it('keeps a message that holds no secret', () => {
    expect(safeFailureMessage('connection reset')).toBe('connection reset')
  })
})
