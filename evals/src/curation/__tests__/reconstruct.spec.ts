import { describe, expect, test } from 'bun:test'

import { sha256Hex } from '../../hash'
import { applyUnifiedDiff, EReconstructionKind, reconstructChange } from '../reconstruct'

const before = 'one\ntwo\nthree\nfour\nfive\nsix\n'

describe('applyUnifiedDiff', () => {
  test('applies a single hunk', () => {
    const result = applyUnifiedDiff({ before, diff: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n' })
    expect(result).toEqual({ kind: EReconstructionKind.Applied, after: 'one\nTWO\nthree\nfour\nfive\nsix\n' })
  })

  test('applies separated hunks sequentially', () => {
    const diff = '@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n@@ -5,2 +5,3 @@\n five\n six\n+seven\n'
    const result = applyUnifiedDiff({ before, diff })
    expect(result.after).toBe('ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n')
  })

  test('ignores file headers', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-one\n+uno\n'
    expect(applyUnifiedDiff({ before, diff }).after).toBe('uno\ntwo\nthree\nfour\nfive\nsix\n')
  })

  test('fails when context does not match and names the hunk', () => {
    const result = applyUnifiedDiff({ before, diff: '@@ -1,2 +1,2 @@\n nope\n-two\n+TWO\n' })
    expect(result.kind).toBe(EReconstructionKind.Failed)
    expect(result.after).toBeNull()
    expect(result.detail).toContain('hunk 1')
  })

  test('fails when a removed line does not match; no fuzz on shifted offsets', () => {
    const result = applyUnifiedDiff({ before, diff: '@@ -2,1 +2,1 @@\n-three\n+THREE\n' })
    expect(result.kind).toBe(EReconstructionKind.Failed)
  })

  test('fails when header counts disagree with the body', () => {
    const result = applyUnifiedDiff({ before, diff: '@@ -1,3 +1,3 @@\n-one\n+ONE\n' })
    expect(result.kind).toBe(EReconstructionKind.Failed)
    expect(result.detail).toContain('counts')
  })

  test('fails on overlapping hunks and on empty diffs', () => {
    const overlapping = '@@ -2,1 +2,1 @@\n-two\n+TWO\n@@ -1,1 +1,1 @@\n-one\n+ONE\n'
    expect(applyUnifiedDiff({ before, diff: overlapping }).kind).toBe(EReconstructionKind.Failed)
    expect(applyUnifiedDiff({ before, diff: '' }).kind).toBe(EReconstructionKind.Failed)
  })

  test('reports an already-applied diff instead of applying twice', () => {
    const diff = '@@ -1,1 +1,1 @@\n-one\n+uno\n'
    const once = applyUnifiedDiff({ before, diff })
    const twice = applyUnifiedDiff({ before: once.after ?? '', diff })
    expect(twice.kind).toBe(EReconstructionKind.AlreadyApplied)
  })

  test('adds a trailing newline removal via the no-newline marker', () => {
    const result = applyUnifiedDiff({
      before: 'a\nb\n',
      diff: '@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n',
    })
    expect(result).toEqual({ kind: EReconstructionKind.Applied, after: 'a\nb' })
  })

  test('adds a trailing newline when the old side had none', () => {
    const result = applyUnifiedDiff({
      before: 'a\nb',
      diff: '@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n',
    })
    expect(result.after).toBe('a\nb\n')
  })

  test('preserves a missing trailing newline when untouched', () => {
    const result = applyUnifiedDiff({
      before: 'a\nb',
      diff: '@@ -1,2 +1,2 @@\n-a\n+A\n b\n\\ No newline at end of file\n',
    })
    expect(result.after).toBe('A\nb')
  })

  test('rejects a baseline whose newline state contradicts the marker', () => {
    const result = applyUnifiedDiff({
      before: 'a\nb\n',
      diff: '@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n',
    })
    expect(result.kind).toBe(EReconstructionKind.Failed)
  })

  test('creates a file from an empty baseline', () => {
    const result = applyUnifiedDiff({ before: '', diff: '@@ -0,0 +1,2 @@\n+a\n+b\n' })
    expect(result.after).toBe('a\nb\n')
  })
})

describe('reconstructChange', () => {
  const diff = '--- a/src/f.ts\n+++ b/src/f.ts\n@@ -1,1 +1,1 @@\n-one\n+uno\n'
  const after = 'uno\ntwo\nthree\nfour\nfive\nsix\n'

  test('returns the change when the digest matches and derives the path from the diff', () => {
    const result = reconstructChange({ before, diff, expectedAfterSha256: sha256Hex({ text: after }) })
    expect(result.ok).toBe(true)
    expect(result.change).toEqual({ path: 'src/f.ts', before, after })
  })

  test('fails on a digest mismatch', () => {
    const result = reconstructChange({ before, diff, expectedAfterSha256: sha256Hex({ text: 'other' }) })
    expect(result).toMatchObject({ ok: false, change: null, kind: EReconstructionKind.Failed })
  })

  test('fails when the diff does not apply', () => {
    const result = reconstructChange({ before, diff: '@@ -1,1 +1,1 @@\n-zzz\n+yyy\n', path: 'f.ts', expectedAfterSha256: sha256Hex({ text: after }) })
    expect(result.ok).toBe(false)
    expect(result.change).toBeNull()
  })

  test('fails with a missing baseline and never substitutes other content', () => {
    const result = reconstructChange({ before: null, diff, expectedAfterSha256: sha256Hex({ text: after }) })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe(EReconstructionKind.Failed)
    expect(result.detail).toContain('baseline is missing')
  })

  test('refuses an already-applied diff', () => {
    const result = reconstructChange({ before: after, diff, expectedAfterSha256: sha256Hex({ text: after }) })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe(EReconstructionKind.AlreadyApplied)
  })
})
