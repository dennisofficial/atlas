import { describe, expect, test } from 'bun:test'

import { sha256Hex } from '../../hash'
import { REDACTION_RULES, redactionMapEquals, redactText } from '../redact'

describe('redactText', () => {
  test('exposes exactly the two allowlisted rules', () => {
    expect(REDACTION_RULES.map((rule) => rule.id)).toEqual(['credential-assignment', 'absolute-home-path'])
  })

  test('redacts credential assignments and keeps the key', () => {
    const result = redactText({ text: 'const x = { apiKey: "sk-live-abcdef123456" }' })
    expect(result.text).toBe('const x = { apiKey: "<redacted>" }')
  })

  test('redacts home paths', () => {
    const result = redactText({ text: 'read /Users/jane.doe/src and /home/bob/x' })
    expect(result.text).toBe('read <redacted:home>/src and <redacted:home>/x')
  })

  test('map records digests of originals, never the originals, and counts occurrences', () => {
    const result = redactText({ text: '/Users/jane/a /Users/jane/b /home/bob/c' })
    const jane = result.map.find((entry) => entry.digest === sha256Hex({ text: '/Users/jane' }))
    expect(jane?.occurrences).toBe(2)
    expect(result.map).toHaveLength(2)
    expect(JSON.stringify(result.map)).not.toContain('jane')
  })

  test('is deterministic and idempotent on already redacted text', () => {
    const text = 'password = "hunter2hunter2"\n/Users/a/b'
    const first = redactText({ text })
    const second = redactText({ text: first.text })
    expect(redactText({ text })).toEqual(first)
    expect(second.text).toBe(first.text)
    expect(second.map).toEqual([])
  })

  test('leaves clean text untouched with an empty map', () => {
    expect(redactText({ text: 'const a = 1' })).toEqual({ text: 'const a = 1', map: [] })
  })

  test('short values are not credentials', () => {
    expect(redactText({ text: 'token: "abc"' }).text).toBe('token: "abc"')
  })
})

describe('redactionMapEquals', () => {
  const entry = { ruleId: 'r', digest: 'd', occurrences: 1 }

  test('equal maps compare equal', () => {
    expect(redactionMapEquals({ left: [entry], right: [{ ...entry }] })).toBe(true)
  })

  test('different occurrences or lengths compare unequal', () => {
    expect(redactionMapEquals({ left: [entry], right: [{ ...entry, occurrences: 2 }] })).toBe(false)
    expect(redactionMapEquals({ left: [entry], right: [] })).toBe(false)
  })
})
