import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { threadMetaFile, threadsDirectory } from '../../store/sessions/paths'
import {
  readIncomingThreadLog,
  readIncomingThreadMeta,
  type ParsedThreadLog,
  type ValidatedIncomingRoot,
} from './descend-validate'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const THREAD_META_SUFFIX = '.meta.json'

const requireIncomingThread = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<ParsedThreadLog> => {
  const meta = await readIncomingThreadMeta({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
  })
  const log = await readIncomingThreadLog({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
    label: `child ${args.threadId}`,
    tolerateTornTail: true,
  })
  if (log.head < meta.head && !log.torn) {
    throw new Error(
      `the cloud transcript thread ${args.threadId} log decodes to head ${log.head} but its metadata says ${meta.head} — refusing to wipe the local copy`,
    )
  }
  return log
}

const listThreadMetasUnder = async (args: {
  sessionDir: string
  root: string
  dir: string
  into: ThreadId[]
}): Promise<void> => {
  const entries = await readdir(args.dir, { withFileTypes: true }).catch((error: unknown) => {
    throw new Error(
      `the cloud transcript threads directory could not be read (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  })
  for (const entry of entries) {
    const path = join(args.dir, entry.name)
    if (entry.isDirectory()) {
      await listThreadMetasUnder({ ...args, dir: path })
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(THREAD_META_SUFFIX)) continue
    const relativeName = relative(args.root, path.slice(0, -THREAD_META_SUFFIX.length))
      .split('/')
      .join('/')
    if (relativeName.startsWith('..') || relativeName === '') continue
    const derived = toThreadId(relativeName)
    if (threadMetaFile({ sessionDir: args.sessionDir, threadId: derived }) !== path) continue
    args.into.push(derived)
  }
}

const listIncomingThreadIds = async (args: { sessionDir: string }): Promise<ThreadId[]> => {
  const root = threadsDirectory({ sessionDir: args.sessionDir })
  const into: ThreadId[] = []
  await listThreadMetasUnder({ sessionDir: args.sessionDir, root, dir: root, into })
  return into
}

export const requireReadableIncomingFamily = async (args: {
  sessionDir: string
  root: ValidatedIncomingRoot
  threadId: ThreadId
}): Promise<void> => {
  await readIncomingThreadMeta({ sessionDir: args.sessionDir, threadId: args.threadId })
  const present = await listIncomingThreadIds({ sessionDir: args.sessionDir })
  const logs = new Map<ThreadId, ParsedThreadLog>()
  for (const threadId of present) {
    if (threadId === args.threadId) continue
    logs.set(threadId, await requireIncomingThread({ sessionDir: args.sessionDir, threadId }))
  }
  const referenced: ThreadId[] = [...args.root.spawned]
  for (const log of logs.values()) referenced.push(...log.spawned)
  for (const spawned of referenced) {
    if (!logs.has(spawned)) {
      throw new Error(
        `the cloud transcript still references child ${spawned} but the archive holds no readable thread for it — refusing to wipe the local copy`,
      )
    }
  }
}
