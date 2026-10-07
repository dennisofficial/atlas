import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toCallId, toRunId, toThreadId, type QualityScope } from '@dltech/atlas-core'

import { singleResponsibilityPolicy } from '../../packages/core/src/quality/policies/single-responsibility'
import { QualityExampleSink, EXAMPLE_SCHEMA_VERSION } from '../../packages/harness/src/quality/example-sink'
import { prepareQualityScopes } from '../../packages/harness/src/quality/source/scope-adapter'
import { writeFileAtomic } from '../src/atomic'

export const PROJECT_DIRECTORY = '/proj'
export const WORKSPACE_NAMESPACE = 'local:eval-test-namespace'
export const SRP_POLICY = 'single-responsibility'

export const makeTmpDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'atlas-curation-'))

export const counterBefore = (): string =>
  ['export class Counter {', '  private total = 0', '', '  add(amount: number): number {', '    this.total += amount', '    return this.total', '  }', '}', ''].join('\n')

export const counterAfter = (): string =>
  [
    'export class Counter {',
    '  private total = 0',
    '',
    '  add(amount: number): number {',
    '    this.total += amount',
    '    return this.total',
    '  }',
    '',
    '  describe(): string {',
    '    return `total=${this.total}`',
    '  }',
    '}',
    '',
  ].join('\n')

export const secretBearingSource = (): string =>
  ['export class Client {', '  apiKey = "sk-live-abcdef123456"', '  cache = "/Users/someone/project/.cache"', '  connect(): void {}', '}', ''].join('\n')

export type RecordedCapture = { sessionDir: string; threadId: string; relativePaths: readonly string[]; scopes: readonly QualityScope[] }

export async function recordCapture({
  sessionDir,
  threadId = 'thread-1',
  path = 'src/counter.ts',
  before,
  after,
}: {
  sessionDir: string
  threadId?: string
  path?: string
  before: string | null
  after: string
}): Promise<RecordedCapture> {
  const sink = new QualityExampleSink({ sessions: { sessionDirOf: async () => sessionDir } })
  const preparation = prepareQualityScopes({
    change: { path: `${PROJECT_DIRECTORY}/${path}`, before, after },
    projectDirectory: PROJECT_DIRECTORY,
    workspaceNamespace: WORKSPACE_NAMESPACE,
    previousScopes: [],
  })
  const selectedIds = new Set(singleResponsibilityPolicy.selectScopes({ scopes: preparation.scopes }))
  const selected = preparation.scopes.filter((scope) => selectedIds.has(scope.id))
  const relativePaths: string[] = []
  for (const scope of selected) {
    const result = await sink.record({
      threadId: toThreadId(threadId),
      runId: toRunId('run-1'),
      callId: toCallId('call-1'),
      toolName: 'write',
      scope,
      change: { path, before, after },
      workspaceNamespace: WORKSPACE_NAMESPACE,
      policyIds: [SRP_POLICY],
      policyVersions: { [SRP_POLICY]: '1' },
      adapterVersion: scope.adapterVersion,
      schemaVersion: EXAMPLE_SCHEMA_VERSION,
    })
    if (!result.ok) throw new Error(result.fault)
    relativePaths.push(result.relativePath)
  }
  return { sessionDir, threadId, relativePaths, scopes: selected }
}

export async function writeRawSinkFile({
  sessionDir,
  threadId = 'thread-1',
  fileStem,
  content,
}: {
  sessionDir: string
  threadId?: string
  fileStem: string
  content: string
}): Promise<string> {
  const directory = join(sessionDir, 'threads', threadId, 'quality', 'examples')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${fileStem}.json`)
  await writeFileAtomic({ path, content })
  return path
}
