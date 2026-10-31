import { wireThreadSchema } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { desktopCall, desktopRequest, hasDesktopHost } from './desktop-http'
import { observeLocalThreadHead } from './local-thread-history'

export const localThreadSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().optional(),
  projectId: z.string().nullable(),
  head: z.number().int().nonnegative(),
  readSeq: z.number().int().nonnegative().nullable(),
  model: z.string().optional(),
  effort: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: wireThreadSchema.shape.status.unwrap(),
})
export type LocalThread = z.infer<typeof localThreadSchema>

const threadListSchema = z.object({ threads: z.array(localThreadSchema) })
export const localThreadPath = (threadId: string): string =>
  `/desktop/threads/${encodeURIComponent(threadId)}`

let listing: Promise<LocalThread[]> | null = null

export function listLocalThreads(): Promise<LocalThread[]> {
  if (!hasDesktopHost()) return Promise.resolve([])
  if (listing !== null) return listing
  const pending = desktopCall({ path: '/desktop/threads', schema: threadListSchema })
    .then((reply) => {
      for (const thread of reply.threads)
        observeLocalThreadHead({ threadId: thread.threadId, head: thread.head })
      return reply.threads
    })
    .finally(() => {
      if (listing === pending) listing = null
    })
  listing = pending
  return pending
}

export async function getLocalThread(threadId: string): Promise<LocalThread | null> {
  return (await listLocalThreads()).find((thread) => thread.threadId === threadId) ?? null
}

export async function renameLocalThread(args: { threadId: string; title: string }): Promise<void> {
  await desktopRequest({
    path: `${localThreadPath(args.threadId)}/rename`,
    method: 'POST',
    body: { title: args.title },
  })
}

const readCursorSchema = z.object({ seq: z.number().int().nonnegative().nullable() })

export const readLocalThreadCursor = (threadId: string) =>
  desktopCall({
    path: `${localThreadPath(threadId)}/read`,
    schema: readCursorSchema,
  })

export const markLocalThreadRead = (args: { threadId: string; seq: number }) =>
  desktopCall({
    path: `${localThreadPath(args.threadId)}/read`,
    method: 'POST',
    body: { seq: args.seq },
    schema: readCursorSchema,
  })
