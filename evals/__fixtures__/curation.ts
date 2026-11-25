import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toCallId, toRunId, toThreadId, type QualityScope } from '@dltech/atlas-core'

import { singleResponsibilityPolicy } from '@dltech/atlas-plugin-quality/review'
import { prepareQualityScopes } from '@dltech/atlas-plugin-quality/review'
import { writeFileAtomic } from '../src/atomic'

export const PROJECT_DIRECTORY = '/proj'
export const WORKSPACE_NAMESPACE = 'local:eval-test-namespace'
export const SRP_POLICY = 'single-responsibility'
export const EXAMPLE_SCHEMA_VERSION = '1'

export const makeTmpDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'atlas-curation-'))

export const counterBefore = (): string =>
  [
    'export class Counter {',
    '  private total = 0',
    '',
    '  add(amount: number): number {',
    '    this.total += amount',
    '    return this.total',
    '  }',
    '}',
    '',
  ].join('\n')

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
  [
    'export class Client {',
    '  apiKey = "sk-live-abcdef123456"',
    '  cache = "/Users/someone/project/.cache"',
    '  connect(): void {}',
    '}',
    '',
  ].join('\n')

export type RecordedCapture = {
  sessionDir: string
  threadId: string
  relativePaths: readonly string[]
  scopes: readonly QualityScope[]
}

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
  const preparation = prepareQualityScopes({
    change: { path: `${PROJECT_DIRECTORY}/${path}`, before, after },
    projectDirectory: PROJECT_DIRECTORY,
    workspaceNamespace: WORKSPACE_NAMESPACE,
    previousScopes: [],
  })
  const selectedIds = new Set(
    singleResponsibilityPolicy.selectScopes({ scopes: preparation.scopes }),
  )
  const selected = preparation.scopes.filter((scope) => selectedIds.has(scope.id))
  const relativePaths: string[] = []
  for (const scope of selected) {
    const content = JSON.stringify({
      schemaVersion: EXAMPLE_SCHEMA_VERSION,
      adapterVersion: scope.adapterVersion,
      provenance: {
        toolName: 'write',
        threadId: toThreadId(threadId),
        runId: toRunId('run-1'),
        callId: toCallId('call-1'),
      },
      workspaceNamespace: WORKSPACE_NAMESPACE,
      path,
      policies: [{ id: SRP_POLICY, version: '1' }],
      scope: {
        id: scope.id,
        kind: scope.kind,
        name: scope.name,
        language: scope.language,
        structuralHash: scope.structuralHash,
        parentScopeId: scope.parentScopeId,
        lineRange: scope.lineRange,
        beforeLineRange: scope.beforeLineRange,
        afterLineRange: scope.afterLineRange,
      },
      hashes: { before: scope.beforeHash, after: scope.afterHash },
      before: scope.before,
      after: scope.after,
      diff: scope.diff,
      dependencyContext: scope.dependencyContext,
      evidence: scope.evidence,
    })
    const digest = createHash('sha256').update(content).digest('hex')
    await writeRawSinkFile({ sessionDir, threadId, fileStem: digest, content })
    relativePaths.push(`threads/${threadId}/quality/examples/${digest}.json`)
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
