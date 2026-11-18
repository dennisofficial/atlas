import { describe, expect, it } from 'bun:test'

import { EChangeFileStatus, EChangeSide } from '../changes-state'
import {
  sessionChangeContentInputSchema,
  sessionChangeContentOutputSchema,
  sessionChangesInputSchema,
  sessionChangesOutputSchema,
} from '../api'

const file = {
  path: 'src/a.ts',
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 3,
  deletions: 1,
  binary: false,
  size: 42,
  baseHash: 'a'.repeat(64),
  currentHash: 'b'.repeat(64),
}

describe('changes schemas', () => {
  it('accepts a checkout list with one file', () => {
    const parsed = sessionChangesOutputSchema.parse({
      checkouts: [
        {
          checkoutId: 'checkout-1',
          repo: 'github.com/acme/repo',
          worktreePath: '/workspace/repo',
          base: 'origin/main',
          updatedAt: 1_700_000_000_000,
          files: [file],
        },
      ],
    })
    expect(parsed.checkouts[0]?.files[0]?.status).toBe(EChangeFileStatus.Modified)
  })

  it('rejects a rename status, a scope field and an extra checkout key', () => {
    expect(
      sessionChangesOutputSchema.safeParse({
        checkouts: [
          {
            checkoutId: 'checkout-1',
            repo: 'repo',
            worktreePath: '/w',
            base: null,
            updatedAt: 0,
            files: [{ ...file, status: 'renamed' }],
          },
        ],
      }).success,
    ).toBe(false)
    expect(sessionChangesInputSchema.safeParse({ sessionId: 'ses-1', scope: 'all' }).success).toBe(
      false,
    )
    expect(
      sessionChangesOutputSchema.safeParse({
        checkouts: [
          {
            checkoutId: 'checkout-1',
            repo: 'repo',
            worktreePath: '/w',
            base: null,
            updatedAt: 0,
            files: [],
            extra: true,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('accepts both sides on the content input and rejects an unknown side', () => {
    expect(
      sessionChangeContentInputSchema.parse({
        sessionId: 'ses-1',
        checkoutId: 'checkout-1',
        path: 'src/a.ts',
        side: EChangeSide.Current,
      }).side,
    ).toBe(EChangeSide.Current)
    expect(
      sessionChangeContentInputSchema.safeParse({
        sessionId: 'ses-1',
        checkoutId: 'checkout-1',
        path: 'src/a.ts',
        side: 'merged',
      }).success,
    ).toBe(false)
  })

  it('requires a url, a hash, a size and a validity in the content output', () => {
    expect(
      sessionChangeContentOutputSchema.safeParse({
        url: 'https://r2.example/x',
        hash: 'a'.repeat(64),
        size: 0,
        validUntil: 1,
      }).success,
    ).toBe(true)
    expect(
      sessionChangeContentOutputSchema.safeParse({ url: 'https://r2.example/x' }).success,
    ).toBe(false)
  })
})
