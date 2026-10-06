import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import type { CallId, CapturedFileChange, QualityScope, RunId, ThreadId } from '@dltech/atlas-core'

import type { SessionRegistry } from '../store/sessions/registry'
import { threadDataDirectory } from '../store/sessions/paths'

export const EXAMPLE_SCHEMA_VERSION = '1'

export type QualityExampleRecordArgs = {
  threadId: ThreadId
  runId: RunId
  callId: CallId
  toolName?: string | undefined
  scope: QualityScope
  change: CapturedFileChange
  workspaceNamespace: string
  policyIds: readonly string[]
  policyVersions?: Readonly<Record<string, string>> | undefined
  adapterVersion: string
  schemaVersion: string
}

export type QualityExampleResult = { ok: true; relativePath: string } | { ok: false; fault: string }

const EXAMPLES_DIRECTORY = ['quality', 'examples']

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function exampleContent(args: QualityExampleRecordArgs): string {
  const { scope } = args
  return JSON.stringify({
    schemaVersion: args.schemaVersion,
    adapterVersion: args.adapterVersion,
    provenance: {
      toolName: args.toolName ?? null,
      threadId: args.threadId,
      runId: args.runId,
      callId: args.callId,
    },
    workspaceNamespace: args.workspaceNamespace,
    path: args.change.path,
    policies: args.policyIds.map((id) => ({ id, version: args.policyVersions?.[id] ?? null })),
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
}

export class QualityExampleSink {
  private readonly sessions: Pick<SessionRegistry, 'sessionDirOf'>

  constructor({ sessions }: { sessions: Pick<SessionRegistry, 'sessionDirOf'> }) {
    this.sessions = sessions
  }

  async record(args: QualityExampleRecordArgs): Promise<QualityExampleResult> {
    try {
      return await this.write(args)
    } catch (error) {
      return { ok: false, fault: `example recording failed: ${describeError(error)}` }
    }
  }

  private async write(args: QualityExampleRecordArgs): Promise<QualityExampleResult> {
    const sessionDir = await this.sessions.sessionDirOf({ threadId: args.threadId })
    if (sessionDir === undefined) {
      return { ok: false, fault: `no session directory is known for thread ${args.threadId}` }
    }

    const content = exampleContent(args)
    const digest = createHash('sha256').update(content).digest('hex')
    const file = join(threadDataDirectory({ sessionDir, threadId: args.threadId }), ...EXAMPLES_DIRECTORY, `${digest}.json`)
    const relativePath = relative(sessionDir, file).split(sep).join('/')

    await mkdir(dirname(file), { recursive: true })
    try {
      const handle = await open(file, 'wx')
      try {
        await handle.writeFile(content)
      } catch (error) {
        await handle.close()
        await rm(file, { force: true })
        throw error
      }
      await handle.close()
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = await readFile(file, 'utf8')
      if (existing !== content) return { ok: false, fault: `existing example ${relativePath} differs from this capture` }
    }
    return { ok: true, relativePath }
  }
}
