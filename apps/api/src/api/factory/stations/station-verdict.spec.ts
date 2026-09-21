import { describe, expect, it } from 'vitest'
import { parseReviewVerdict } from './station-verdict'
import { EReviewVerdict } from './station.types'

const validVerdict = () => ({
  verdict: EReviewVerdict.RequestChanges,
  summary: 'The marker file is wrong.',
  criteria: [{ criterion: 'FACTORY.md carries the required line', pass: false, note: 'it says X' }],
  findings: [{ severity: 'blocker', path: 'FACTORY.md', summary: 'wrong content' }],
})

describe('parseReviewVerdict', () => {
  it('accepts the contract the reviewer prompt teaches', () => {
    const parsed = parseReviewVerdict(validVerdict())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.verdict.verdict).toBe(EReviewVerdict.RequestChanges)
  })

  it('accepts an approve with no findings', () => {
    const parsed = parseReviewVerdict({
      ...validVerdict(),
      verdict: EReviewVerdict.Approve,
      findings: [],
    })
    expect(parsed.ok).toBe(true)
  })

  it('refuses unknown verdicts and missing fields', () => {
    expect(parseReviewVerdict({ ...validVerdict(), verdict: 'lgtm' }).ok).toBe(false)
    expect(parseReviewVerdict({ ...validVerdict(), summary: '' }).ok).toBe(false)
    expect(parseReviewVerdict('approve').ok).toBe(false)
  })

  it('refuses malformed criteria and findings', () => {
    expect(
      parseReviewVerdict({ ...validVerdict(), criteria: [{ criterion: 'x', pass: 'yes' }] }).ok,
    ).toBe(false)
    expect(
      parseReviewVerdict({ ...validVerdict(), findings: [{ severity: 'blocker' }] }).ok,
    ).toBe(false)
  })
})
