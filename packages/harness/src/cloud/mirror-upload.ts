import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EExecutionLocation,
  ERunner,
  executionLocationOf,
  runnerOf,
  toThreadId,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'
import { MAX_POD_EVENTS_PER_FLUSH, type PodEvent, type PodEventsReply } from '@dltech/atlas-wire'

import { readMeta, threadMetaSchema, writeMeta } from '../store/sessions/meta'
import { sessionsDirectory, threadMetaFile } from '../store/sessions/paths'
import { registryFor } from '../store/sessions/registry'
import { CloudError } from './cloud-transport'
import { podEventOf } from './pod-event'

export const UPLOAD_STAMP_NAME = '.postgres-upload.json'

const UPLOAD_CONCURRENCY = 3
const SOURCE = 'cloud.mirror-upload'

export type MirrorUploadClient = {
  threadHead: (args: { threadId: string }) => Promise<number>
  importEvents: (args: { threadId: string; events: readonly PodEvent[] }) => Promise<PodEventsReply>
}

const stampFile = (args: { sessionDir: string }): string => join(args.sessionDir, UPLOAD_STAMP_NAME)

const stamped = async (args: { sessionDir: string }): Promise<boolean> =>
  Bun.file(stampFile(args)).exists()

const stamp = async (args: { sessionDir: string; head: number }): Promise<void> => {
  await writeMeta({
    file: stampFile(args),
    meta: { v: 1, head: args.head, uploadedAt: new Date().toISOString() },
  })
}

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const uploadThread = async (args: {
  home: string
  sessionDir: string
  threadId: ThreadId
  client: MirrorUploadClient
  log: LogPort
}): Promise<void> => {
  const { sessionDir, threadId, client, log } = args
  const local = await registryFor({ home: args.home }).readThreadLog({ sessionDir, threadId })
  if (local.head === 0) return
  const remoteHead = await client.threadHead({ threadId })
  if (remoteHead >= local.head) {
    await stamp({ sessionDir, head: remoteHead })
    return
  }
  const pending = local.events.filter((event) => event.seq > remoteHead).map(podEventOf)
  for (let start = 0; start < pending.length; start += MAX_POD_EVENTS_PER_FLUSH) {
    const events = pending.slice(start, start + MAX_POD_EVENTS_PER_FLUSH)
    try {
      await client.importEvents({ threadId, events })
    } catch (failure) {
      if (failure instanceof CloudError && failure.status === 409) {
        log.warn({
          source: SOURCE,
          threadId,
          message: `the local mirror differs from Postgres at seq ${events[0]?.seq}..${events.at(-1)?.seq}: ${reasonOf(failure)} — leaving this thread's history as it is`,
        })
        return
      }
      throw failure
    }
  }
  await stamp({ sessionDir, head: local.head })
}

const cloudThreadDirs = async (args: {
  home: string
}): Promise<{ sessionDir: string; threadId: ThreadId }[]> => {
  const root = sessionsDirectory({ home: args.home })
  const names = await readdir(root).catch(() => [] as string[])
  const found = await Promise.all(
    names.map(async (name) => {
      const sessionDir = join(root, name)
      const threadId = toThreadId(name)
      const meta = await readMeta({
        file: threadMetaFile({ sessionDir, threadId }),
        schema: threadMetaSchema,
      }).catch(() => undefined)
      if (meta === undefined) return []
      if (executionLocationOf(meta.executionLocation) !== EExecutionLocation.Cloud) return []
      if (runnerOf(meta.runner) === ERunner.Local) return []
      return [{ sessionDir, threadId }]
    }),
  )
  return found.flat()
}

export async function uploadLocalMirrors(args: {
  home: string
  client: MirrorUploadClient
  log: LogPort
}): Promise<void> {
  const queue = (await cloudThreadDirs({ home: args.home })).filter(Boolean)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const target = queue[next]
      next += 1
      if (target === undefined) return
      if (await stamped(target)) continue
      try {
        await uploadThread({ ...target, home: args.home, client: args.client, log: args.log })
      } catch (failure) {
        args.log.warn({
          source: SOURCE,
          threadId: target.threadId,
          message: `uploading the local mirror failed: ${reasonOf(failure)}`,
        })
      }
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()))
}
