import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { skillSummarySchema, skillUsageReplySchema } from '../skills-wire'

const summary = {
  name: 'review',
  description: '',
  fileCount: 1,
  sizeBytes: 10,
  updatedAt: '2026-11-27T12:00:00Z',
  usage: { usedCount30d: 0, lastUsedAt: null },
  usagePending: true,
  origin: 'personal',
  overridesBuiltIn: false,
}

describe('skill usage contracts', () => {
  it('marks unloaded usage without removing the legacy object old clients read', () => {
    expect(skillSummarySchema.parse(summary).usagePending).toBe(true)
    const oldSummarySchema = skillSummarySchema.omit({ usagePending: true })
    expect(oldSummarySchema.parse(summary).usage.usedCount30d).toBe(0)
  })

  it('accepts summaries from older servers that have no pending marker', () => {
    const { usagePending, ...legacy } = summary
    expect(usagePending).toBe(true)
    expect(skillSummarySchema.parse(legacy).usagePending).toBeUndefined()
  })

  it('validates a per-name usage reply and rejects invalid counts', () => {
    expect(skillUsageReplySchema.parse({ usage: { review: summary.usage } }).usage.review).toEqual(
      summary.usage,
    )
    expect(() =>
      skillUsageReplySchema.parse({ usage: { review: { usedCount30d: -1, lastUsedAt: null } } }),
    ).toThrow(z.ZodError)
  })
})
