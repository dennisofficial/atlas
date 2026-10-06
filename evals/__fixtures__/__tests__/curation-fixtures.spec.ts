import { afterEach, describe, expect, test } from 'bun:test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { sha256Hex } from '../../src/hash'
import { capturedExampleSchema } from '../../src/curation/inventory'
import { buildCaptureJson, captureFixture, makeExampleDir, makeTmpDir, smallSyntheticScopeText } from '../curation'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('curation fixtures', () => {
  test('buildCaptureJson round-trips through the captured example schema with correct digests', () => {
    const after = smallSyntheticScopeText()
    const example = buildCaptureJson({ path: 'src/counter.ts', before: null, after })
    const decoded = capturedExampleSchema.parse(JSON.parse(JSON.stringify(example)))
    expect(decoded.digests.beforeSha256).toBeNull()
    expect(decoded.digests.afterSha256).toBe(sha256Hex({ text: after }))
  })

  test('before digest is computed when a baseline exists, and overrides apply', () => {
    const example = buildCaptureJson({ path: 'a.ts', before: 'x', after: 'y', threadId: 'thread-9', adapterVersion: 'v2' })
    expect(example.digests.beforeSha256).toBe(sha256Hex({ text: 'x' }))
    expect(example.threadId).toBe('thread-9')
    expect(example.adapterVersion).toBe('v2')
  })

  test('makeExampleDir writes captures under threads/<threadId>/quality/examples', async () => {
    const tmp = await makeTmpDir()
    created.push(tmp)
    const example = buildCaptureJson({ path: 'a.ts', before: null, after: 'z', captureId: 'cap-1', threadId: 'thread-2' })
    await makeExampleDir({ tmp, captures: [captureFixture({ example })] })
    const dir = join(tmp, 'threads', 'thread-2', 'quality', 'examples')
    expect(await readdir(dir)).toEqual(['cap-1.json'])
    expect(capturedExampleSchema.parse(JSON.parse(await readFile(join(dir, 'cap-1.json'), 'utf8')))).toEqual(example)
  })
})
