import { describe, expect, it } from 'bun:test'

import { createDictationCursor } from '../dictation-cursor'

describe('createDictationCursor', () => {
  it('appends at the end when the field was never focused', () => {
    const cursor = createDictationCursor()

    expect(cursor.insertAt({ textLength: 12 })).toBe(12)
  })

  it('ignores a caret the field reports while it is not focused', () => {
    const cursor = createDictationCursor()

    cursor.select({ start: 0 })

    expect(cursor.insertAt({ textLength: 12 })).toBe(12)
  })

  it('inserts where the operator put the caret', () => {
    const cursor = createDictationCursor()

    cursor.focus()
    cursor.select({ start: 5 })

    expect(cursor.insertAt({ textLength: 12 })).toBe(5)
  })

  it('keeps the caret when tapping the mic takes focus from the field', () => {
    const cursor = createDictationCursor()

    cursor.focus()
    cursor.select({ start: 5 })
    cursor.blur()
    cursor.select({ start: 0 })

    expect(cursor.insertAt({ textLength: 12 })).toBe(5)
  })

  it('continues after the dictated words when the field comes back without focus', () => {
    const cursor = createDictationCursor()

    cursor.focus()
    cursor.select({ start: 3 })
    cursor.suspend()
    cursor.select({ start: 0 })
    cursor.settle({ at: 20 })
    cursor.select({ start: 0 })

    expect(cursor.insertAt({ textLength: 30 })).toBe(20)
  })

  it('never inserts past the text', () => {
    const cursor = createDictationCursor()

    cursor.focus()
    cursor.select({ start: 40 })

    expect(cursor.insertAt({ textLength: 0 })).toBe(0)
  })
})
