import { afterEach, describe, expect, test } from 'bun:test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  counterAfter,
  counterBefore,
  makeTmpDir,
  recordCapture,
  secretBearingSource,
  writeRawSinkFile,
} from '../../../__fixtures__/curation'
import { sha256Hex } from '../../hash'
import { EExportRejection, exportExamples, type ExportDeps } from '../inventory'
import { redactText } from '../redact'
import { reparseScope } from '../reparse-scope'

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
  reparse: reparseScope,
  now: () => '2026-10-06T00:00:00.000Z',
  ...overrides,
})

const outputIn = async (): Promise<string> => join(await tmpDir(), 'out')

const exportOne = async ({ before, after, overrides }: { before: string | null; after: string; overrides?: Partial<ExportDeps> }) => {
  const sessionDir = await tmpDir()
  const capture = await recordCapture({ sessionDir, before, after })
  const outputDir = await outputIn()
  const report = await exportExamples({ sessionDirs: [sessionDir], outputDir, deps: deps(overrides) })
  const id = basename(capture.relativePaths[0] ?? '', '.json')
  return { sessionDir, outputDir, report, id }
}

describe('exportExamples against the production sink', () => {
  test('preserves the stored scope snapshot, evidence and provenance; capture id is the sink digest', async () => {
    const { outputDir, report, id, sessionDir } = await exportOne({ before: counterBefore(), after: counterAfter() })

    expect(report.rejections).toEqual([])
    const written = JSON.parse(await readFile(join(outputDir, `${id}.json`), 'utf8'))
    expect(written.schemaVersion).toBe(1)
    expect(written.sinkSchemaVersion).toBe('1')
    expect(written.captureId).toBe(id)
    expect(written.session).toBe(basename(sessionDir))
    expect(written.provenance).toEqual({ toolName: 'write', threadId: 'thread-1', runId: 'run-1', callId: 'call-1' })
    expect(written.scope.kind).toBe('class')
    expect(written.scope.name).toBe('Counter')
    expect(written.scope.after).toStartWith('export class Counter')
    expect(written.scope.after).not.toContain('import ')
    expect(written.scope.before).not.toBeNull()
    expect(written.scope.diff).toContain('+  describe(): string')
    expect(written.scope.evidence.map((entry: { label: string }) => entry.label)).toEqual(['total', 'add', 'describe'])
    expect(written).not.toHaveProperty('capturedAt')
    expect(written.digests.redacted.afterSha256).toBe(sha256Hex({ text: written.scope.after }))
  })

  test('is a scope snapshot, never a full-file capture', async () => {
    const source = `import { x } from './x'\n\n${counterAfter()}\nexport const unrelated = 1\n`
    const { outputDir, id } = await exportOne({ before: null, after: source })
    const written = JSON.parse(await readFile(join(outputDir, `${id}.json`), 'utf8'))
    expect(written.scope.after).not.toContain('unrelated')
    expect(written.scope.dependencyContext).toEqual(["import { x } from './x'"])
  })

  test('redacts every source-bearing field and keeps per-field redaction maps', async () => {
    const { outputDir, id, report } = await exportOne({ before: null, after: secretBearingSource() })

    expect(report.rejections).toEqual([])
    const text = await readFile(join(outputDir, `${id}.json`), 'utf8')
    expect(text).not.toContain('sk-live-abcdef123456')
    expect(text).not.toContain('/Users/someone')
    const written = JSON.parse(text)
    expect(written.redaction.after.length).toBeGreaterThan(0)
    expect(written.redaction.diff.length).toBeGreaterThan(0)
    expect(written.scope.diff).toContain('<redacted>')
    expect(written.digests.original.afterSha256).not.toBe(written.digests.redacted.afterSha256)
  })

  test('rejects an unsupported sink schema version legibly', async () => {
    const sessionDir = await tmpDir()
    await writeRawSinkFile({ sessionDir, fileStem: 'a'.repeat(64), content: JSON.stringify({ schemaVersion: '2' }) })
    const report = await exportExamples({ sessionDirs: [sessionDir], outputDir: await outputIn(), deps: deps() })
    expect(report.rejections[0]?.kind).toBe(EExportRejection.SchemaInvalid)
    expect(report.rejections[0]?.detail).toContain('unsupported sink schemaVersion "2"')
  })

  test('rejects the legacy numeric schemaVersion 1 flat format', async () => {
    const sessionDir = await tmpDir()
    await writeRawSinkFile({ sessionDir, fileStem: 'b'.repeat(64), content: JSON.stringify({ schemaVersion: 1, captureId: 'x' }) })
    const report = await exportExamples({ sessionDirs: [sessionDir], outputDir: await outputIn(), deps: deps() })
    expect(report.rejections[0]?.detail).toContain('unsupported sink schemaVersion 1')
  })

  test('rejects content whose digest differs from the file name', async () => {
    const { sessionDir, id } = await exportOne({ before: null, after: counterAfter() })
    const file = join(sessionDir, 'threads', 'thread-1', 'quality', 'examples', `${id}.json`)
    const text = await readFile(file, 'utf8')
    await rm(file)
    await writeRawSinkFile({ sessionDir, fileStem: id, content: `${text} ` })
    const report = await exportExamples({ sessionDirs: [sessionDir], outputDir: await outputIn(), deps: deps() })
    expect(report.rejections.map((entry) => [entry.captureId, entry.kind])).toEqual([[id, EExportRejection.DigestMismatch]])
    expect(report.rejections[0]?.detail).toContain('content digest')
  })

  test('rejects tampered after text even when the file name matches the tampered bytes', async () => {
    const { sessionDir, id } = await exportOne({ before: null, after: counterAfter() })
    const file = join(sessionDir, 'threads', 'thread-1', 'quality', 'examples', `${id}.json`)
    const record = JSON.parse(await readFile(file, 'utf8'))
    record.after = `${record.after}// tampered`
    const tampered = JSON.stringify(record)
    await rm(file)
    await writeRawSinkFile({ sessionDir, fileStem: sha256Hex({ text: tampered }), content: tampered })
    const report = await exportExamples({ sessionDirs: [sessionDir], outputDir: await outputIn(), deps: deps() })
    expect(report.rejections[0]?.kind).toBe(EExportRejection.DigestMismatch)
    expect(report.rejections[0]?.detail).toContain('hashes.after')
  })

  test('rejects a record whose provenance thread differs from its directory', async () => {
    const { sessionDir, id } = await exportOne({ before: null, after: counterAfter() })
    const source = join(sessionDir, 'threads', 'thread-1', 'quality', 'examples', `${id}.json`)
    const text = await readFile(source, 'utf8')
    await writeRawSinkFile({ sessionDir, threadId: 'thread-2', fileStem: id, content: text })
    const report = await exportExamples({ sessionDirs: [sessionDir], outputDir: await outputIn(), deps: deps() })
    expect(report.rejections.map((entry) => entry.kind)).toEqual([EExportRejection.SchemaInvalid])
  })

  test('rejects adapter reparse failures and writes nothing for them', async () => {
    const { outputDir, report } = await exportOne({ before: null, after: counterAfter(), overrides: { reparse: () => 'cannot parse' } })
    expect(report.exported).toBe(0)
    expect(report.rejections[0]?.kind).toBe(EExportRejection.AdapterMismatch)
    expect((await readdir(outputDir)).sort()).toEqual(['manifest.json', 'rejections.jsonl'])
  })

  test('rejects a redactor that is not stable on its own output', async () => {
    const growing: ExportDeps['redact'] = (text) => ({ text: `${text}!`, map: [] })
    const { report } = await exportOne({ before: null, after: counterAfter(), overrides: { redact: growing } })
    expect(report.rejections[0]?.kind).toBe(EExportRejection.RedactionUnstable)
  })

  test('a session without examples yields NoExamples and processing continues', async () => {
    const empty = await tmpDir()
    const good = await tmpDir()
    await recordCapture({ sessionDir: good, before: null, after: counterAfter() })
    const report = await exportExamples({ sessionDirs: [empty, good], outputDir: await outputIn(), deps: deps() })
    expect(report.exported).toBe(1)
    expect(report.rejections).toEqual([
      { session: basename(empty), captureId: null, kind: EExportRejection.NoExamples, detail: 'no captured examples found' },
    ])
  })

  test('refuses an existing output directory and a missing session directory', async () => {
    await expect(exportExamples({ sessionDirs: [], outputDir: await tmpDir(), deps: deps() })).rejects.toThrow('output directory already exists')
    const missing = join(await tmpDir(), 'nope')
    await expect(exportExamples({ sessionDirs: [missing], outputDir: await outputIn(), deps: deps() })).rejects.toThrow('session directory does not exist')
  })

  test('manifest records only base names, never absolute session directories', async () => {
    const { outputDir, sessionDir, id } = await exportOne({ before: null, after: counterAfter() })
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8')
    expect(JSON.parse(manifestText)).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-10-06T00:00:00.000Z',
      sessions: [basename(sessionDir)],
      exported: [id],
      rejections: [],
    })
    expect(manifestText).not.toContain(sessionDir)
  })
})
