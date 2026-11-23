import { describe, expect, it } from 'bun:test'
import { memoryPromptText } from '../prompt'

describe('memoryPromptText', () => {
  it('keeps harness behaviour out of memory', () => {
    const text = memoryPromptText()
    expect(text).toContain('Do not save how the Atlas harness itself behaves or misbehaves')
    expect(text).toContain('a harness defect to fix in its code')
  })
})
