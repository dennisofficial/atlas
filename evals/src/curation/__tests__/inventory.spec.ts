import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { buildCaptureJson, captureFixture, makeExampleDir, makeTmpDir, secretBearingScopeText, smallSyntheticScopeText } from '../../../__fixtures__/curation'
import { sha256Hex } from '../../hash'
import { EExportRejection, exportExamples, type ExportDeps } from '../inventory'
import { redactText } from '../redact'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

const tmpDir = async (): Promise<string> => {
  const dir = await makeTmpDir()
  created.push(dir)
  return dir
}

const deps = (overrides: Partial<ExportDeps> = {}): ExportDeps => ({
  redact: (text) => redactText({ text }),
  reparse: () => true,
  now: () => '2026-10-06T00:00:00.000Z',
  ...overrides,
})

const outputIn = async (): Promise<string> => join(await tmpDir(), 'out')

describe('exportExamples', () => {
  test('exports redacted examples with original and redacted digests plus manifest and ledger', async () => {
    const session = await tmpDir()
    const example = buildCaptureJson({ path: 'src/client.ts', before: null, after: secretBearingScopeText(), captureId: 'cap-a' })
    await makeExampleDir({ tmp: session, captures: [captureFixture({ example })] })
    const outputDir = await outputIn()

    const report = await exportExamples({ sessionDirs: [session], outputDir, deps: deps() })

    expect(report.exported).toBe(1)
    expect(report.rejections).toEqual([])
    const written = JSON.parse(await readFile(join(outputDir, 'cap-a.json'), 'utf8'))
    expect(written.change.after).not.toContain('sk-live')
    expect(written.change.after).not.toContain('/Users/someone')
    expect(written.digests.original.afterSha256).toBe(sha256Hex({ text: secretBearingScopeText() }))
    expect(written.digests.redacted.afterSha256).toBe(sha256Hex({ text: written.change.after }))
    expect(written.redaction.after.length).toBeGreaterThan(0)
    expect(JSON.stringify(written)).not.toContain('sk-live-abcdef123456')
    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))
    expect(manifest).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-10-06T00:00:00.000Z',
      sessionDirs: [session],
      exported: ['cap-a'],
      rejections: [],
    })
    expect(await readFile(join(outputDir, 'rejections.jsonl'), 'utf8')).toBe('')
  })

  test('refuses an existing output directory', async () => {
    const outputDir = await tmpDir()
    await expect(exportExamples({ sessionDirs: [], outputDir, deps: deps() })).rejects.toThrow('output directory already exists')
  })

  test('a session without an examples directory yields NoExamples and processing continues', async () => {
    const empty = await tmpDir()
    const good = await tmpDir()
    const example = buildCaptureJson({ path: 'a.ts', before: null, after: smallSyntheticScopeText(), captureId: 'cap-ok' })
    await makeExampleDir({ tmp: good, captures: [captureFixture({ example })] })

    const report = await exportExamples({ sessionDirs: [empty, good], outputDir: await outputIn(), deps: deps() })

    expect(report.exported).toBe(1)
    expect(report.rejections).toEqual([
      { sessionDir: empty, captureId: null, kind: EExportRejection.NoExamples, detail: 'no captured examples found' },
    ])
  })

  test('rejects schema-invalid captures, including missing digests', async () => {
    const session = await tmpDir()
    const valid = buildCaptureJson({ path: 'a.ts', before: null, after: 'x', captureId: 'cap-nodigest' })
    const { digests: _digests, ...withoutDigests } = valid
    await makeExampleDir({
      tmp: session,
      captures: [
        { threadId: 'thread-1', captureId: 'cap-nodigest', json: withoutDigests },
        { threadId: 'thread-1', captureId: 'cap-wrongversion', json: { ...valid, schemaVersion: 2 } },
      ],
    })

    const report = await exportExamples({ sessionDirs: [session], outputDir: await outputIn(), deps: deps() })

    expect(report.exported).toBe(0)
    expect(report.rejections.map((rejection) => rejection.kind)).toEqual([
      EExportRejection.SchemaInvalid,
      EExportRejection.SchemaInvalid,
    ])
  })

  test('rejects non-JSON files as schema invalid', async () => {
    const session = await tmpDir()
    const dir = join(session, 'threads', 't', 'quality', 'examples')
    await mkdir(dir, { recursive: true })
    await Bun.write(join(dir, 'broken.json'), '{not json')

    const report = await exportExamples({ sessionDirs: [session], outputDir: await outputIn(), deps: deps() })

    expect(report.rejections[0]?.kind).toBe(EExportRejection.SchemaInvalid)
  })

  test('rejects digest mismatches for before and after', async () => {
    const session = await tmpDir()
    const valid = buildCaptureJson({ path: 'a.ts', before: 'old', after: 'new', captureId: 'cap-good' })
    const badAfter = { ...valid, captureId: 'cap-bad-after', change: { ...valid.change, after: 'tampered' } }
    const badBefore = { ...valid, captureId: 'cap-bad-before', change: { ...valid.change, before: 'tampered' } }
    await makeExampleDir({
      tmp: session,
      captures: [
        { threadId: 'thread-1', captureId: 'cap-bad-after', json: badAfter },
        { threadId: 'thread-1', captureId: 'cap-bad-before', json: badBefore },
      ],
    })

    const report = await exportExamples({ sessionDirs: [session], outputDir: await outputIn(), deps: deps() })

    expect(report.rejections.map((rejection) => [rejection.captureId, rejection.kind])).toEqual([
      ['cap-bad-after', EExportRejection.DigestMismatch],
      ['cap-bad-before', EExportRejection.DigestMismatch],
    ])
  })

  test('rejects adapter reparse failures on the redacted change', async () => {
    const session = await tmpDir()
    const example = buildCaptureJson({ path: 'a.ts', before: null, after: 'x', captureId: 'cap-r' })
    await makeExampleDir({ tmp: session, captures: [captureFixture({ example })] })
    const outputDir = await outputIn()

    const report = await exportExamples({ sessionDirs: [session], outputDir, deps: deps({ reparse: () => false }) })

    expect(report.exported).toBe(0)
    expect(report.rejections[0]?.kind).toBe(EExportRejection.AdapterMismatch)
    expect(await readdir(outputDir)).not.toContain('cap-r.json')
  })

  test('rejects a redactor that is not stable on its own output', async () => {
    const session = await tmpDir()
    const example = buildCaptureJson({ path: 'a.ts', before: null, after: 'x', captureId: 'cap-u' })
    await makeExampleDir({ tmp: session, captures: [captureFixture({ example })] })
    const growing: ExportDeps['redact'] = (text) => ({ text: `${text}!`, map: [] })

    const report = await exportExamples({ sessionDirs: [session], outputDir: await outputIn(), deps: deps({ redact: growing }) })

    expect(report.rejections[0]?.kind).toBe(EExportRejection.RedactionUnstable)
  })

  test('reads only examples files and orders sessions and files lexically', async () => {
    const sessionB = await tmpDir()
    const sessionA = await tmpDir()
    const first = buildCaptureJson({ path: 'a.ts', before: null, after: 'a', captureId: 'cap-1', threadId: 'thread-b' })
    const second = buildCaptureJson({ path: 'b.ts', before: null, after: 'b', captureId: 'cap-2', threadId: 'thread-a' })
    await makeExampleDir({ tmp: sessionB, captures: [captureFixture({ example: first })] })
    await makeExampleDir({ tmp: sessionA, captures: [captureFixture({ example: second })] })
    await Bun.write(join(sessionA, 'events.jsonl'), 'SECRET sk-should-never-be-read')
    await Bun.write(join(sessionA, 'threads', 'thread-a', 'quality', 'notes.txt'), 'ignored')
    const outputDir = await outputIn()

    const report = await exportExamples({ sessionDirs: [sessionB, sessionA], outputDir, deps: deps() })

    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))
    expect(manifest.sessionDirs).toEqual([sessionA, sessionB].sort())
    expect(report.exported).toBe(2)
    expect((await readdir(outputDir)).sort()).toEqual(['cap-1.json', 'cap-2.json', 'manifest.json', 'rejections.jsonl'])
  })

  test('writes one JSON object per rejection line', async () => {
    const empty = await tmpDir()
    const outputDir = await outputIn()

    await exportExamples({ sessionDirs: [empty], outputDir, deps: deps() })

    const lines = (await readFile(join(outputDir, 'rejections.jsonl'), 'utf8')).trim().split('\n')
    expect(lines.map((line) => JSON.parse(line).kind)).toEqual([EExportRejection.NoExamples])
  })
})
