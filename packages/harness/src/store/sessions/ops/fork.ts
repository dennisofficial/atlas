import { writeFile } from 'node:fs/promises'

import {
  EForkMode,
  type ClockPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { ForkSeqOutOfRange, ForkSourceMissing } from '../../fork'
import {
  SESSION_FORMAT_VERSION,
  newThreadMeta,
  readMetaSync,
  threadMetaSchema,
  writeMeta,
  type ThreadMeta,
} from '../meta'
import {
  eventLogFile,
  sessionDirectory,
  sessionMetaFile,
  threadMetaFile,
} from '../paths'
import type { SessionRegistry } from '../registry'

export { ForkSeqOutOfRange, ForkSourceMissing } from '../../fork'

export type ForkedSession = {
  threadId: ThreadId
  sessionDir: string
  meta: ThreadMeta
}

export async function forkThread({
  home,
  registry,
  ids,
  clock,
  from,
  seq,
  title,
}: {
  home: string
  registry: SessionRegistry
  ids: IdPort
  clock: ClockPort
  from: ThreadId
  seq: number
  title?: string | undefined
}): Promise<ForkedSession> {
  const sourceDir =
    (await registry.sessionDirOf({ threadId: from })) ?? sessionDirectory({ home, sessionId: from })
  const source = readMetaSync({
    file: threadMetaFile({ sessionDir: sourceDir, threadId: from }),
    schema: threadMetaSchema,
  })
  if (source === undefined) throw new ForkSourceMissing({ from })

  const head = (await registry.readThreadLog({ sessionDir: sourceDir, threadId: from })).head
  if (!Number.isInteger(seq) || seq < 0 || seq > head) {
    throw new ForkSeqOutOfRange({ from, seq, head })
  }

  const at = clock.now()
  const into = ids.nextThreadId()
  const sessionDir = sessionDirectory({ home, sessionId: into })

  const meta: ThreadMeta = {
    ...newThreadMeta({ id: into, at }),
    title: title ?? null,
    parentThreadId: from,
    forkSeq: seq,
    forkMode: EForkMode.Reference,
    workspace: source.workspace,
    repo: source.repo,
    modelRef: source.modelRef,
    modelEffort: source.modelEffort,
    executionLocation: source.executionLocation,
  }
  await writeMeta({ file: threadMetaFile({ sessionDir, threadId: into }), meta })
  await writeFile(eventLogFile({ sessionDir, threadId: into }), '', 'utf8')

  await writeMeta({
    file: sessionMetaFile({ sessionDir }),
    meta: {
      format: SESSION_FORMAT_VERSION,
      id: into,
      title: title ?? null,
      createdAt: at,
      updatedAt: at,
      home: source.executionLocation ?? 'host',
      repo: source.repo,
      workspace: source.workspace,
      worktree: null,
      pullRequests: null,
      spend: null,
    },
  })

  registry.registerThread({ sessionDir, threadId: into })
  return { threadId: into, sessionDir, meta }
}
