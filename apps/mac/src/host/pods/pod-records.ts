import { rm } from 'node:fs/promises'
import {
  EExecutionLocation,
  EHarnessPlacement,
  ERunner,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'
import { listLocalPodThreads, registryFor, type ThreadSummary } from '@dltech/atlas-harness'
import type { LocalThreadSummary } from '@dltech/atlas-harness/activity'
import { SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'
import type { ILocalStore } from './local-store'
import type { CreatePodInput, LocalThread } from './wire'

export type PodRecord = ThreadSummary & { projectId: string }

export class NotAPodThreadError extends Error {
  constructor(threadId: string) {
    super(`the thread ${threadId} already exists and does not run on a local pod`)
    this.name = 'NotAPodThreadError'
  }
}

const recordOf = (summary: ThreadSummary | undefined): PodRecord | undefined => {
  if (summary === undefined || summary.runner !== ERunner.Local) return undefined
  if (summary.projectId === undefined || summary.projectId === null) return undefined
  return { ...summary, projectId: summary.projectId }
}

export async function findPodRecord({
  store,
  threadId,
}: {
  store: ILocalStore
  threadId: ThreadId
}): Promise<PodRecord | undefined> {
  return recordOf(await store.threads.find({ threadId }).catch(() => undefined))
}

export async function listPodRecords({ store }: { store: ILocalStore }): Promise<PodRecord[]> {
  const listed = await listLocalPodThreads({ home: store.home })
  return listed.flatMap((summary) => recordOf(summary) ?? [])
}

export async function ensurePodRecord({
  store,
  input,
}: {
  store: ILocalStore
  input: CreatePodInput
}): Promise<PodRecord> {
  const threadId = toThreadId(input.threadId)
  const existing = await findPodRecord({ store, threadId })
  if (existing !== undefined) return existing
  const model =
    input.model === undefined || input.effort === undefined
      ? undefined
      : { ref: input.model, effort: input.effort }
  if ((await store.threads.find({ threadId })) !== undefined) throw new NotAPodThreadError(threadId)
  await store.threads.create({
    id: threadId,
    workspace: SANDBOX_WORKSPACE_PATH,
    repo: null,
    executionLocation: EExecutionLocation.Cloud,
    ...(model === undefined ? {} : { model }),
  })
  await store.threads.writePlacement({
    threadId,
    record: { placement: { harness: EHarnessPlacement.Cloud }, revision: 1 },
  })
  await store.threads.chooseRunner({ threadId, runner: ERunner.Local })
  await store.threads.chooseProject({ threadId, projectId: input.projectId })
  const created = await findPodRecord({ store, threadId })
  if (created === undefined) throw new Error(`could not record the pod thread ${threadId}`)
  return created
}

export async function removePodRecord({
  store,
  threadId,
}: {
  store: ILocalStore
  threadId: ThreadId
}): Promise<void> {
  const registry = registryFor({ home: store.home })
  const sessionDir = await registry.sessionDirOf({ threadId })
  if (sessionDir === undefined) return
  await rm(sessionDir, { recursive: true, force: true })
  registry.invalidateSession({ sessionDir })
  registry.forgetThread({ sessionDir, threadId })
}

export const localThreadOf = ({
  record,
  summary,
}: {
  record: ThreadSummary
  summary: LocalThreadSummary
}): LocalThread => ({
  threadId: record.id,
  ...(record.title === undefined ? {} : { title: record.title }),
  projectId: record.projectId ?? null,
  ...summary,
  ...(record.model === undefined ? {} : { model: record.model.ref, effort: record.model.effort }),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  archivedAt: record.archivedAt,
})
