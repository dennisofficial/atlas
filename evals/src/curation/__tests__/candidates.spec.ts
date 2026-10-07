import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { makeCandidate } from '../../../__fixtures__/candidate'
import { counterAfter, counterBefore, makeTmpDir, recordCapture } from '../../../__fixtures__/curation'
import { sha256Hex } from '../../hash'
import { candidateFromExport, dedupeCandidates, ECandidateMethod, readExportDir, writeCandidates } from '../candidates'
import { defaultExportDeps, exportExamples } from '../inventory'
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

const exportCaptures = async (captures: readonly { before: string | null; after: string; path?: string }[]): Promise<string> => {
  const session = await tmpDir()
  for (const capture of captures) await recordCapture({ sessionDir: session, ...capture })
  const outputDir = join(await tmpDir(), 'export')
  await exportExamples({
    sessionDirs: [session],
    outputDir,
    deps: { ...defaultExportDeps({ reparse: reparseScope }), now: () => '2026-10-06T00:00:00.000Z' },
  })
  return outputDir
}

describe('dedupeCandidates', () => {
  test('keeps the lexically first candidate among identical scope content', () => {
    const { kept, duplicates } = dedupeCandidates({
      candidates: [makeCandidate({ id: 'fork-b' }), makeCandidate({ id: 'fork-a' }), makeCandidate({ id: 'other', after: 'y' })],
    })
    expect(kept.map((entry) => entry.candidateId)).toEqual(['fork-a', 'other'])
    expect(duplicates).toEqual([{ candidateId: 'fork-b', duplicateOf: 'fork-a' }])
  })

  test('before null and before empty string count as the same content key', () => {
    const a = makeCandidate({ id: 'a', before: null })
    const b = makeCandidate({ id: 'b', before: '' })
    expect(dedupeCandidates({ candidates: [a, b] }).duplicates).toEqual([{ candidateId: 'b', duplicateOf: 'a' }])
  })

  test('different before with the same after is not a duplicate', () => {
    const { kept } = dedupeCandidates({ candidates: [makeCandidate({ id: 'a', before: 'p' }), makeCandidate({ id: 'b', before: 'q' })] })
    expect(kept).toHaveLength(2)
  })
})

describe('candidateFromExport and readExportDir', () => {
  test('carries the stored scope snapshot, redaction maps and digest-based ids into candidates', async () => {
    const exportDir = await exportCaptures([{ before: counterBefore(), after: counterAfter() }])
    const { examples, manifest } = await readExportDir({ exportDir })
    const [example] = examples
    if (example === undefined) throw new Error('missing example')
    expect(manifest.exported).toEqual([example.captureId])
    const candidate = candidateFromExport({ example, method: ECandidateMethod.ProspectiveCapture })
    expect(candidate.candidateId).toMatch(/^[0-9a-f]{64}$/)
    expect(candidate.group).toBe(sha256Hex({ text: `${example.session}\n${example.path}` }))
    expect(candidate.provenance.sourceHash).toBe(sha256Hex({ text: example.scope.after ?? '' }))
    expect(candidate.snapshot.scope).toEqual(example.scope)
    expect(candidate.snapshot.redaction).toEqual(example.redaction)
    expect(candidate.snapshot.workspaceNamespace).toBe(example.workspaceNamespace)
  })

  test('identical paths in different sessions get different groups', async () => {
    const a = (await readExportDir({ exportDir: await exportCaptures([{ before: null, after: counterAfter() }]) })).examples[0]
    const b = (await readExportDir({ exportDir: await exportCaptures([{ before: null, after: counterAfter() }]) })).examples[0]
    if (a === undefined || b === undefined) throw new Error('missing example')
    expect(candidateFromExport({ example: a, method: ECandidateMethod.ProspectiveCapture }).group).not.toBe(
      candidateFromExport({ example: b, method: ECandidateMethod.ProspectiveCapture }).group,
    )
  })

  test('throws when the manifest is missing, or disagrees with the files present', async () => {
    await expect(readExportDir({ exportDir: await tmpDir() })).rejects.toThrow()
    const exportDir = await exportCaptures([{ before: null, after: counterAfter() }])
    await Bun.write(join(exportDir, 'stray.json'), '{}')
    await expect(readExportDir({ exportDir })).rejects.toThrow('does not match')
  })

  test('rejects an exported example carrying unknown fields', async () => {
    const exportDir = await exportCaptures([{ before: null, after: counterAfter() }])
    const { examples } = await readExportDir({ exportDir })
    const id = examples[0]?.captureId ?? ''
    const path = join(exportDir, `${id}.json`)
    const record = JSON.parse(await readFile(path, 'utf8'))
    await Bun.write(path, JSON.stringify({ ...record, change: { path: 'x', before: null, after: 'whole file' } }))
    await expect(readExportDir({ exportDir })).rejects.toThrow('is invalid')
  })
})

describe('writeCandidates', () => {
  test('writes candidates.jsonl and a manifest with counts', async () => {
    const outputDir = join(await tmpDir(), 'cands')
    await writeCandidates({
      outputDir,
      candidates: [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b', after: 'z' })],
    })
    expect((await readFile(join(outputDir, 'candidates.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))).toEqual({ schemaVersion: 2, count: 2, groups: 2 })
  })

  test('refuses an existing output directory', async () => {
    await expect(writeCandidates({ outputDir: await tmpDir(), candidates: [] })).rejects.toThrow('output directory already exists')
  })
})
