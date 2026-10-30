import { describe, expect, test } from 'bun:test'
import { safeUploadName } from '../upload-name'

describe('safeUploadName', () => {
  test('keeps a plain name', () => {
    expect(safeUploadName('report.pdf')).toBe('report.pdf')
  })

  test('keeps only the basename for posix and windows paths', () => {
    expect(safeUploadName('../../etc/passwd')).toBe('passwd')
    expect(safeUploadName('C:\\Users\\me\\doc.txt')).toBe('doc.txt')
  })

  test('strips NUL and control characters and collapses whitespace', () => {
    expect(safeUploadName('a\u0000b\tc   d\n.txt')).toBe('a b c d .txt')
  })

  test('never returns empty, dot or dotdot', () => {
    expect(safeUploadName('')).toBe('file')
    expect(safeUploadName('   ')).toBe('file')
    expect(safeUploadName('.')).toBe('file')
    expect(safeUploadName('..')).toBe('file')
    expect(safeUploadName('a/')).toBe('file')
  })

  test('truncates to 120 characters keeping the extension', () => {
    const result = safeUploadName(`${'x'.repeat(300)}.tar.gz`)
    expect(result.length).toBe(120)
    expect(result.endsWith('.gz')).toBe(true)
  })

  test('truncates an extensionless name', () => {
    expect(safeUploadName('y'.repeat(300)).length).toBe(120)
  })
})
