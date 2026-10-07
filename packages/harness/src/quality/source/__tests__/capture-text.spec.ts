import { EQualitySkipReason } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { MAX_CAPTURE_SOURCE_BYTES, captureText, captureUnavailableFault, makeChange } from '../capture-text'

describe('captureText', () => {
  it('returns exact text when the strict decode matches', () => {
    const result = captureText({ path: '/p/a.ts', text: 'const a = 1\n', strict: 'const a = 1\n', changed: true })
    expect(result).toEqual({ ok: true, text: 'const a = 1\n' })
  })

  it('returns null text when nothing changed', () => {
    const result = captureText({ path: '/p/a.ts', text: 'same', strict: 'same', changed: false })
    expect(result).toEqual({ ok: true, text: null })
  })

  it('flags InvalidText when the strict decode failed', () => {
    const result = captureText({ path: '/p/a.ts', text: 'bad', strict: null, changed: true })
    if (result.ok) throw new Error('expected a diagnostic')
    expect(result.diagnostic.reason).toBe(EQualitySkipReason.InvalidText)
    expect(result.diagnostic.path).toBe('/p/a.ts')
  })

  it('flags InvalidText when lossy and strict decode differ', () => {
    const result = captureText({ path: '/p/a.ts', text: '﻿bom', strict: 'bom', changed: true })
    if (result.ok) throw new Error('expected a diagnostic')
    expect(result.diagnostic.reason).toBe(EQualitySkipReason.InvalidText)
  })

  it('flags OversizedSource past the byte bound', () => {
    const big = 'x'.repeat(MAX_CAPTURE_SOURCE_BYTES + 1)
    const result = captureText({ path: '/p/a.ts', text: big, strict: big, changed: true })
    if (result.ok) throw new Error('expected a diagnostic')
    expect(result.diagnostic.reason).toBe(EQualitySkipReason.OversizedSource)
  })

  it('preserves CRLF, BOM and absent trailing newline in the captured text', () => {
    const text = '﻿const a = 1\r\nconst b = 2'
    const result = captureText({ path: '/p/a.ts', text, strict: text, changed: true })
    expect(result).toEqual({ ok: true, text })
  })
})

describe('captureUnavailableFault', () => {
  it('builds a SourceUnavailable diagnostic', () => {
    const fault = captureUnavailableFault({ path: '/p/a.ts', detail: 'gone' })
    expect(fault.reason).toBe(EQualitySkipReason.SourceUnavailable)
    expect(fault.path).toBe('/p/a.ts')
    expect(fault.detail).toBe('gone')
  })
})

describe('makeChange', () => {
  it('wraps a single change in a readonly array', () => {
    const changes = makeChange({ path: '/p/a.ts', before: 'a', after: 'b' })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ path: '/p/a.ts', before: 'a', after: 'b' })
  })
})
