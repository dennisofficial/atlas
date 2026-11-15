import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(`${import.meta.dirname}/../base.css`, 'utf8')
const TOUCH_MEDIA = '@media (pointer: coarse) {'

function depthAt(index: number): number {
  let depth = 0
  for (const char of css.slice(0, index)) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
  }
  return depth
}

function blockAt(start: number): string {
  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0 && css[index] === '}') return css.slice(start, index + 1)
  }
  throw new Error('unterminated block')
}

describe('base.css form fields on touch screens', () => {
  const start = css.indexOf(TOUCH_MEDIA)

  test('sit outside every cascade layer so call-site text utilities cannot shrink them', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(depthAt(start)).toBe(0)
  })

  test('render at 16px, the size below which iOS Safari zooms a focused field', () => {
    const block = blockAt(start)
    for (const selector of ['input:not(', 'textarea', 'select', '[contenteditable]']) {
      expect(block).toContain(selector)
    }
    expect(block).toContain('font-size: 16px;')
  })

  test('leave non-text inputs alone', () => {
    const block = blockAt(start)
    for (const type of ['checkbox', 'radio', 'range', 'file']) {
      expect(block).toContain(`[type="${type}"]`)
    }
  })
})
