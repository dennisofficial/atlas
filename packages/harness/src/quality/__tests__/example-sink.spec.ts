import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { QualityExampleSink, type QualityExampleRecordArgs } from '../example-sink'
import { THREAD, call, change, scopeNamed, RUN } from './fixtures'

let sessionDir = ''

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'quality-sink-'))
})

afterEach(async () => {
  await rm(sessionDir, { recursive: true, force: true })
})

const args = (overrides: Partial<QualityExampleRecordArgs> = {}): QualityExampleRecordArgs => ({
  threadId: THREAD,
  runId: RUN,
  callId: call.callId,
  toolName: 'write',
  scope: scopeNamed(),
  change: { ...change, path: 'src/a.ts' },
  workspaceNamespace: 'ns',
  policyIds: ['srp'],
  policyVersions: { srp: '1' },
  adapterVersion: 'ts-1',
  schemaVersion: '1',
  ...overrides,
})

describe('QualityExampleSink', () => {
  it('writes a complete labelless example under the resolved thread data directory', async () => {
    const lookups: unknown[] = []
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async (lookup) => (lookups.push(lookup), sessionDir) } })
    const result = await sink.record(args())
    if (!result.ok) throw new Error(result.fault)

    expect(lookups).toEqual([{ threadId: THREAD }])
    expect(result.relativePath.startsWith('/')).toBe(false)
    expect(result.relativePath).toMatch(new RegExp(`^threads/${THREAD}/quality/examples/[0-9a-f]{64}\\.json$`))
    const saved = JSON.parse(await readFile(join(sessionDir, result.relativePath), 'utf8'))
    expect(saved.provenance).toEqual({ toolName: 'write', threadId: THREAD, runId: RUN, callId: call.callId })
    expect(saved.path).toBe('src/a.ts')
    expect(saved.before).toBe('class Widget {}')
    expect(saved.after).toBe('class Widget { run() {} }')
    expect(saved.diff).toBe('+ run() {}')
    expect(saved.hashes).toEqual({ before: 'b1', after: 'a1' })
    expect(saved.policies).toEqual([{ id: 'srp', version: '1' }])
    expect(saved.adapterVersion).toBe('ts-1')
    expect(saved.schemaVersion).toBe('1')
    expect(Object.keys(saved).sort()).toEqual([
      'adapterVersion', 'after', 'before', 'dependencyContext', 'diff', 'evidence', 'hashes',
      'path', 'policies', 'provenance', 'schemaVersion', 'scope', 'workspaceNamespace',
    ])
  })

  it('records a fault and writes nothing when the thread has no known session directory', async () => {
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => undefined } })
    const result = await sink.record(args())
    expect(result.ok).toBe(false)
    expect(await readdir(sessionDir)).toEqual([])
  })

  it('returns the same path without rewriting evidence on an identical capture', async () => {
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => sessionDir } })
    const first = await sink.record(args())
    if (!first.ok) throw new Error(first.fault)
    const file = join(sessionDir, first.relativePath)
    const before = await stat(file)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = await sink.record(args())
    expect(second).toEqual(first)
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs)
  })

  it('writes a distinct file when the content differs', async () => {
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => sessionDir } })
    const first = await sink.record(args())
    const second = await sink.record(args({ scope: scopeNamed({ after: 'class Widget {}' }) }))
    expect(first.ok && second.ok && first.relativePath !== second.relativePath).toBe(true)
  })

  it('never throws on I/O failure', async () => {
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => join(sessionDir, 'missing', '\0bad') } })
    expect((await sink.record(args())).ok).toBe(false)
    const rejecting = new QualityExampleSink({ sessions: { sessionDirOf: async () => Promise.reject(new Error('lookup')) } })
    expect((await rejecting.record(args())).ok).toBe(false)
  })

  it('reports a fault when an existing example at the digest differs from this capture', async () => {
    const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => sessionDir } })
    const first = await sink.record(args())
    if (!first.ok) throw new Error(first.fault)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(sessionDir, first.relativePath), '{"corrupted":true}')

    const second = await sink.record(args())
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.fault).toContain('differs from this capture')
  })
})
