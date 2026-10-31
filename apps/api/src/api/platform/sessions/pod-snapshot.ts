import { db, type Row } from '@dltech/atlas-db'
import { EThreadStreamFrame, type PodStatus } from '@dltech/atlas-wire'
import { NotFoundException } from '@nestjs/common'
import { readPodLifecycle } from '../sandboxes/pod-status'

export type ThreadPodSnapshot = {
  type: EThreadStreamFrame.Pod
  status: PodStatus
  rev: number
}

export type PodSnapshot = {
  row: Row<'CloudSandbox'> | null
  status: PodStatus
  rev: number
}

export function readPodSnapshot(args: {
  threadId: string
  bumpRev?: boolean
}): Promise<PodSnapshot> {
  return db.transaction(async (tx) => {
    const statement = args.bumpRev
      ? tx.raw
          .sql`UPDATE "Thread" SET "rev" = "rev" + 1 WHERE "id" = ${args.threadId} RETURNING "rev"`
      : tx.raw.sql`SELECT "rev" FROM "Thread" WHERE "id" = ${args.threadId} FOR UPDATE`
    const [thread] = await tx.query(statement.returnsRow({ rev: 'pg/int4@1' }).build())
    if (thread === undefined) throw new NotFoundException('thread not found')
    const { row, status } = await readPodLifecycle({ reader: tx, threadId: args.threadId })
    return { row, status: { ...status, rev: thread.rev }, rev: thread.rev }
  })
}

export async function readPodFrame(args: {
  threadId: string
  bumpRev?: boolean
}): Promise<ThreadPodSnapshot> {
  const { status, rev } = await readPodSnapshot(args)
  return { type: EThreadStreamFrame.Pod, status, rev }
}
