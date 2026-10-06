import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { buildCaptureJson, captureFixture, makeExampleDir, makeTmpDir } from '../../../__fixtures__/curation'
import { sha256Hex } from '../../hash'
import {
  candidateFromExport,
  dedupeCandidates,
  ECandidateMethod,
  readExportDir,
  writeCandidates,
  type Candidate,
} from '../candidates'
import { exportExamples } from '../inventory'
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

const candidate = ({ id, path = 'a.ts', before = null, after = 'x' }: { id: string; path?: string; before?: string | null; after?: string }): Candidate => ({
  schemaVersion: 1,
  candidateId: id,
  method: ECandidateMethod.ProspectiveCapture,
  group: sha256Hex({ text: path }),
  provenance: { sessionDir: '/s', captureId: id, adapterVersion: 'v1', sourceHash: sha256Hex({ text: after }) },
  change: { path, before, after },
})

const exportOne = async (captures: Parameters<typeof buildCaptureJson>[0][]): Promise<string> => {
  const session = await tmpDir()
  const examples = captures.map((capture, index) => buildCaptureJson({ ...capture, captureId: `cap-${index}` }))
  await makeExampleDir({ tmp: session, captures: examples.map((example) => captureFixture({ example })) })
  const outputDir = join(await tmpDir(), 'export')
  await exportExamples({
    sessionDirs: [session],
    outputDir,
    deps: { redact: (text) => redactText({ text }), reparse: () => true, now: () => '2026-10-06T00:00:00.000Z' },
  })
  return outputDir
}

describe('dedupeCandidates', () => {
  test('keeps the lexically first candidate among identical content (forks duplicated by inheritance)', () => {
    const { kept, duplicates } = dedupeCandidates({
      candidates: [candidate({ id: 'fork-b' }), candidate({ id: 'fork-a' }), candidate({ id: 'other', after: 'y' })],
    })
    expect(kept.map((entry) => entry.candidateId)).toEqual(['fork-a', 'other'])
    expect(duplicates).toEqual([{ candidateId: 'fork-b', duplicateOf: 'fork-a' }])
  })

  test('before null and before empty string count as the same content key', () => {
    const { duplicates } = dedupeCandidates({
      candidates: [candidate({ id: 'a', before: null }), candidate({ id: 'b', before: '' })],
    })
    expect(duplicates).toEqual([{ candidateId: 'b', duplicateOf: 'a' }])
  })

  test('different before with the same after is not a duplicate', () => {
    const { kept } = dedupeCandidates({ candidates: [candidate({ id: 'a', before: 'p' }), candidate({ id: 'b', before: 'q' })] })
    expect(kept).toHaveLength(2)
  })
})

describe('candidateFromExport and readExportDir', () => {
  test('round-trips an export into candidates grouped by path hash', async () => {
    const exportDir = await exportOne([
      { path: 'src/a.ts', before: null, after: 'one' },
      { path: 'src/a.ts', before: 'one', after: 'two' },
    ])
    const { examples, manifest } = await readExportDir({ exportDir })
    expect(manifest.exported).toEqual(['cap-0', 'cap-1'])
    const [first, second] = examples.map((example) => candidateFromExport({ example, method: ECandidateMethod.ProspectiveCapture }))
    expect(first?.group).toBe(sha256Hex({ text: 'src/a.ts' }))
    expect(first?.group).toBe(second?.group)
    expect(first?.provenance.sourceHash).toBe(sha256Hex({ text: 'one' }))
    expect(first?.provenance.captureId).toBe('cap-0')
  })

  test('throws when the manifest is missing', async () => {
    await expect(readExportDir({ exportDir: await tmpDir() })).rejects.toThrow()
  })

  test('throws when an example file is not referenced by the manifest', async () => {
    const exportDir = await exportOne([{ path: 'a.ts', before: null, after: 'x' }])
    await Bun.write(join(exportDir, 'stray.json'), '{}')
    await expect(readExportDir({ exportDir })).rejects.toThrow('does not match')
  })

  test('throws when the manifest references a missing example file', async () => {
    const exportDir = await exportOne([{ path: 'a.ts', before: null, after: 'x' }])
    await rm(join(exportDir, 'cap-0.json'))
    await expect(readExportDir({ exportDir })).rejects.toThrow('does not match')
  })
})

describe('writeCandidates', () => {
  test('writes candidates.jsonl and a manifest with counts', async () => {
    const outputDir = join(await tmpDir(), 'cands')
    await writeCandidates({
      outputDir,
      candidates: [candidate({ id: 'a', path: 'x.ts' }), candidate({ id: 'b', path: 'x.ts', after: 'z' }), candidate({ id: 'c', path: 'y.ts' })],
    })
    const lines = (await readFile(join(outputDir, 'candidates.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))).toEqual({ schemaVersion: 1, count: 3, groups: 2 })
  })

  test('refuses an existing output directory', async () => {
    await expect(writeCandidates({ outputDir: await tmpDir(), candidates: [] })).rejects.toThrow('output directory already exists')
  })
})
