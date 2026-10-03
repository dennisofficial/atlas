import { describe, expect, it } from 'bun:test'

import { operatorEditorText, operatorTextAfterEdit, operatorTextWithPaste } from '../operator-input-text'

describe('lossless operator input around native newline normalization', () => {
  it('uses normalized line endings only for the editor, not for the delivered source', () => {
    const source = '  a\r\nb\rc\n  '
    expect(operatorEditorText(source)).toBe('  a\nb\nc\n  ')
    expect(operatorTextAfterEdit({ source, edited: '  a\nb\nc\n  ' })).toBe(source)
  })

  it('keeps untouched CRLF and bare CR line endings while inserting and deleting text', () => {
    const source = 'first\r\nsecond\rthird\n'
    expect(operatorTextAfterEdit({ source, edited: 'first\nseXcond\nthird\n' })).toBe('first\r\nseXcond\rthird\n')
    expect(operatorTextAfterEdit({ source, edited: 'first\nseond\nthird\n' })).toBe('first\r\nseond\rthird\n')
  })

  it('gives newly typed newlines LF without changing pasted newline endings', () => {
    expect(operatorTextAfterEdit({ source: 'first\r\nsecond', edited: 'first\nsecond\n' })).toBe('first\r\nsecond\n')
    expect(operatorTextAfterEdit({ source: 'first\r\nsecond', edited: 'firstsecond' })).toBe('firstsecond')
  })

  it('inserts the exact clipboard bytes at an editor position and replaces selections', () => {
    expect(operatorTextWithPaste({ source: 'a\r\nb\nc', start: 2, end: 3, pasted: '  x\r\ny  ' })).toBe('a\r\n  x\r\ny  \nc')
    expect(operatorTextWithPaste({ source: '\r\n\n\r\n', start: 1, end: 2, pasted: '\r' })).toBe('\r\n\r\r\n')
  })

  it('replaces the complete selection with an empty or whitespace-only paste', () => {
    expect(operatorTextWithPaste({ source: 'a\r\nb', start: 0, end: 3, pasted: '' })).toBe('')
    expect(operatorTextWithPaste({ source: 'a\r\nb', start: 0, end: 3, pasted: ' \t\n ' })).toBe(' \t\n ')
  })
})
