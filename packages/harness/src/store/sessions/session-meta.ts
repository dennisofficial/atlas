import { EExecutionLocation } from '@dltech/atlas-core'

import {
  SESSION_FORMAT_VERSION,
  readMetaSync,
  sessionMetaSchema,
  writeMeta,
  type SessionMeta,
  type ThreadMeta,
} from './meta'
import { sessionMetaFile } from './paths'
import type { SessionRegistry } from './registry'

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
      home,
      repo: root.repo,
      workspace: root.workspace,
      worktree: existing?.worktree ?? null,
      pullRequests: existing?.pullRequests ?? null,
      spend: existing?.spend ?? null,
    }),
  })
}
