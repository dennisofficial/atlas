import { createHash, randomUUID } from 'node:crypto'

import { db } from '@dltech/atlas-db'

export const digestOfContent = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

export async function putContextFile(args: {
  threadId: string
  path: string
  content: string
}): Promise<void> {
  const { threadId, path, content } = args
  await db.orm.public.ContextFile.upsert({
    conflictOn: { threadId, path },
    create: {
      id: `ctxf_${randomUUID()}`,
      threadId,
      path,
      content,
      digest: digestOfContent(content),
      updatedAt: new Date(),
    },
    update: {
      content,
      digest: digestOfContent(content),
      updatedAt: new Date(),
    },
  })
}

export async function deleteContextFile(args: { threadId: string; path: string }): Promise<void> {
  await db.orm.public.ContextFile.where({ threadId: args.threadId, path: args.path }).delete()
}

export async function deleteMissingContextFiles(args: {
  threadId: string
  keep: readonly string[]
}): Promise<void> {
  const { threadId, keep } = args
  const stored = await db.orm.public.ContextFile.where({ threadId }).select('path').all()
  const keepSet = new Set(keep)
  const stale = stored.filter((row) => !keepSet.has(row.path)).map((row) => row.path)
  for (const path of stale) {
    await db.orm.public.ContextFile.where({ threadId, path }).delete()
  }
}
