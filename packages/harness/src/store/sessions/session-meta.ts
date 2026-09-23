import { existsSync } from 'node:fs'

import { EExecutionLocation, executionLocationOf } from '@dltech/atlas-core'

import { sumSessionSpend } from '../../ledger/jsonl'
import {
  SESSION_FORMAT_VERSION,
  readMetaSync,
  sessionMetaSchema,
  writeMeta,
  type SessionMeta,
  type ThreadMeta,
} from './meta'
import { ledgerFile, sessionMetaFile } from './paths'
import type { SessionRegistry } from './registry'
import type { ThreadPlaces } from './thread-places'

async function rewriteSessionMeta({
  registry,
  sessionDir,
  build,
}: {
  registry: SessionRegistry
  sessionDir: string
  build: (existing: SessionMeta | undefined) => Promise<SessionMeta | undefined>
}): Promise<void> {
  const file = sessionMetaFile({ sessionDir })
  const handle = registry.handleFor({ sessionDir })
  await registry.enqueue({
    handle,
    run: async () => {
      const existing = readMetaSync({ file, schema: sessionMetaSchema })
      const meta = await build(existing)
      if (meta !== undefined) await writeMeta({ file, meta })
    },
  })
}

export async function writeSessionMetaForRoot({
  registry,
  sessionDir,
  root,
  home,
}: {
  registry: SessionRegistry
  sessionDir: string
  root: ThreadMeta
  home: EExecutionLocation
}): Promise<void> {
  await rewriteSessionMeta({
    registry,
    sessionDir,
    build: async (existing) => ({
      format: existing?.format ?? SESSION_FORMAT_VERSION,
      id: root.id,
      title: root.title,
      createdAt: existing?.createdAt ?? root.createdAt,
      updatedAt:
        existing !== undefined && existing.updatedAt > root.updatedAt ? existing.updatedAt : root.updatedAt,
      home: existing?.home ?? home,
      repo: root.repo,
      workspace: root.workspace,
      worktree: existing?.worktree ?? null,
      pullRequests: existing?.pullRequests ?? null,
      spend: existing?.spend ?? null,
    }),
  })
}

export async function refreshSessionCaches({
  registry,
  sessionDir,
  root,
  activityAt,
  places,
}: {
  registry: SessionRegistry
  sessionDir: string
  root: ThreadMeta
  activityAt: string
  places: ThreadPlaces
}): Promise<void> {
  await rewriteSessionMeta({
    registry,
    sessionDir,
    build: async (existing) => {
      const meta: SessionMeta = {
        format: existing?.format ?? SESSION_FORMAT_VERSION,
        id: root.id,
        title: root.title,
        createdAt: existing?.createdAt ?? root.createdAt,
        updatedAt: activityAt,
        home: existing?.home ?? executionLocationOf(root.executionLocation) ?? EExecutionLocation.Host,
        repo: root.repo,
        workspace: root.workspace,
        worktree: places.worktree?.path ?? null,
        pullRequests: places.pullRequests.length === 0 ? null : places.pullRequests.map((pr) => pr.number),
        spend: (await recomputeSpend({ sessionDir })) ?? existing?.spend ?? null,
      }
      if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(meta)) return undefined
      return meta
    },
  })
}

async function recomputeSpend({ sessionDir }: { sessionDir: string }): Promise<SessionMeta['spend']> {
  if (!existsSync(ledgerFile({ sessionDir }))) return null
  return sumSessionSpend({ sessionDir })
}
