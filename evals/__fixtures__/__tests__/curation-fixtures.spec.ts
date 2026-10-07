import { afterEach, describe, expect, test } from 'bun:test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { EQualityScopeKind } from '@dltech/atlas-core'

import { sha256Hex } from '../../src/hash'
import { counterAfter, counterBefore, makeTmpDir, recordCapture } from '../curation'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('curation fixtures', () => {
  test('recordCapture writes only the policy-selected scope through the production sink', async () => {
    const sessionDir = await makeTmpDir()
    created.push(sessionDir)

    const capture = await recordCapture({ sessionDir, before: counterBefore(), after: counterAfter() })

    expect(capture.scopes.map((scope) => [scope.kind, scope.name])).toEqual([[EQualityScopeKind.Class, 'Counter']])
    const directory = join(sessionDir, 'threads', 'thread-1', 'quality', 'examples')
    const files = await readdir(directory)
    expect(files).toHaveLength(1)
    const text = await readFile(join(directory, files[0] ?? ''), 'utf8')
    expect(files[0]).toBe(`${sha256Hex({ text })}.json`)
    expect(JSON.parse(text).schemaVersion).toBe('1')
  })
})
