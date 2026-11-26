import { describe, expect, test } from 'bun:test'

import {
  READING_HEADING_LEADING,
  READING_LEADING,
  READING_MEASURE_REM,
  readingClasses,
  readingRole,
  readingType,
} from '../reading'
import { ETextRole, REM_PX, typeScale } from '../scale'

describe('reading tokens', () => {
  test('native body text is Apple 17pt body over a 26pt line', () => {
    expect(readingType.body).toEqual({ fontSize: 17, lineHeight: 26 })
    expect(READING_LEADING).toBeCloseTo(1.53, 2)
  })

  test('every heading is at least as large as body text, except the muted h6', () => {
    const headings = [
      readingType.h1,
      readingType.h2,
      readingType.h3,
      readingType.h4,
      readingType.h5,
    ]
    for (const heading of headings) {
      expect(heading.fontSize).toBeGreaterThanOrEqual(readingType.body.fontSize)
    }
    expect(readingType.h1.fontSize).toBe(20)
    expect(readingType.h6.fontSize).toBe(typeScale.sm.fontSize)
  })

  test('heading and body sizes come from the shared type scale', () => {
    expect(readingRole.body).toBe(ETextRole.Reading)
    expect(readingType.h2.fontSize).toBe(typeScale.lg.fontSize)
    expect(readingType.h6.lineHeight).toBe(
      Math.round(typeScale.sm.fontSize * READING_HEADING_LEADING),
    )
  })

  test('the reading measure caps at 56rem, the width of max-w-4xl', () => {
    expect(READING_MEASURE_REM).toBe(56)
    expect(READING_MEASURE_REM * REM_PX).toBe(896)
  })

  test('web body is one px smaller than native body but keeps the same line', () => {
    const webBody = webTypeOf(readingClasses.body)
    expect(webBody.size).toBe(readingType.body.fontSize - 1)
    expect(Math.round(webBody.size * (webBody.leading ?? 0))).toBe(readingType.body.lineHeight)
    expect(webSizeOf(readingClasses.composer)).toBe(webBody.size)
  })

  test('every web heading class carries the native size, less the native body bump', () => {
    for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      const bump = readingRole[key] === ETextRole.Reading ? 1 : 0
      const { size, leading } = webTypeOf(readingClasses[key])
      expect({ key, size: size + bump }).toEqual({ key, size: readingType[key].fontSize })
      expect(leading).toBe(READING_HEADING_LEADING)
    }
    expect(WEB_MEASURE[readingClasses.measure]).toBe(READING_MEASURE_REM)
  })
})

const WEB_SIZE: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
}

const WEB_LEADING: Record<string, number> = {
  'leading-snug': 1.375,
  'leading-relaxed': 1.625,
}

const WEB_MEASURE: Record<string, number> = { 'max-w-4xl': 56 }

const classesOf = (value: string): string[] =>
  value.split(' ').map((name) => name.replace(/^md:/, ''))

const webSizeOf = (value: string): number | undefined => {
  const name = classesOf(value).find((candidate) => candidate in WEB_SIZE)
  return name === undefined ? undefined : WEB_SIZE[name]
}

const webTypeOf = (value: string) => {
  const names = classesOf(value)
  const size = names.find((candidate) => candidate in WEB_SIZE)
  const leading = names.find((candidate) => candidate in WEB_LEADING)
  return {
    size: size === undefined ? 0 : (WEB_SIZE[size] ?? 0),
    leading: leading === undefined ? undefined : WEB_LEADING[leading],
  }
}
