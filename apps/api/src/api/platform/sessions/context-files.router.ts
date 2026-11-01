import { db } from '@dltech/atlas-db'
import {
  contextFileReadInputSchema,
  contextFileReadReplySchema,
  contextFilesListInputSchema,
  contextFilesListReplySchema,
  type ContextFileReadInput,
  type ContextFilesListInput,
  type ContextFileContentWire,
} from '@dltech/atlas-wire'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { ownedThread } from './ownership'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from './session-or-sandbox.middleware'

const readMeta = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

const refused = (reason: string): ContextFileContentWire => ({ type: 'refused', reason })

@Router({ alias: 'contextFiles' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ContextFilesRouter {
  @Query({
    input: contextFilesListInputSchema,
    output: contextFilesListReplySchema,
    meta: readMeta,
  })
  async list(
    @Input() input: ContextFilesListInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<{ entries: { name: string; isDirectory: boolean }[] }> {
    await ownedThread({ reader: db, userId: ctx.auth.userId, threadId: input.threadId })
    const rows = await db.orm.public.ContextFile.where({ threadId: input.threadId })
      .select('path')
      .all()
    const directory = input.directory ?? ''
    const prefix = directory === '' ? '' : `${directory.replace(/\/+$/, '')}/`
    const seen = new Set<string>()
    const entries: { name: string; isDirectory: boolean }[] = []
    for (const { path } of rows) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '') continue
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      const isDirectory = slash !== -1
      const key = `${isDirectory ? 'd' : 'f'}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ name, isDirectory })
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return { entries }
  }

  @Query({
    input: contextFileReadInputSchema,
    output: contextFileReadReplySchema,
    meta: readMeta,
  })
  async read(
    @Input() input: ContextFileReadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<{ file: ContextFileContentWire }> {
    await ownedThread({ reader: db, userId: ctx.auth.userId, threadId: input.threadId })
    const row = await db.orm.public.ContextFile.where({
      threadId: input.threadId,
      path: input.path,
    }).first()
    if (row === null) return { file: refused('the file is not mirrored to the API') }
    return { file: { type: 'text', content: row.content, truncated: false } }
  }
}
