import { BadRequestException, Injectable } from '@nestjs/common'
import {
  COMPOSER_DRAFT_NEW_THREAD_SCOPE,
  type ComposerDraft,
  type ComposerDraftPutInput,
  saidUploadWireSchema,
} from '@dltech/atlas-wire'
import { z } from 'zod'
import { db } from '@dltech/atlas-db'
import { ownedThread } from '../../platform/sessions/ownership'

const attachmentsSchema = z.array(saidUploadWireSchema)

async function threadIdOfScope(args: { userId: string; scope: string }): Promise<string | null> {
  if (args.scope === COMPOSER_DRAFT_NEW_THREAD_SCOPE) return null
  const thread = await ownedThread({
    reader: db,
    userId: args.userId,
    threadId: args.scope,
  })
  return thread.id
}

function draftOf(row: {
  scopeKey: string
  text: string
  attachments: string
  updatedAt: Date
}): ComposerDraft {
  const parsed = attachmentsSchema.safeParse(JSON.parse(row.attachments))
  if (!parsed.success) throw new BadRequestException('stored draft attachments are malformed')
  return {
    scope: row.scopeKey,
    text: row.text,
    uploads: parsed.data,
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class ComposerDraftsService {
  async put(args: { userId: string } & ComposerDraftPutInput): Promise<ComposerDraft> {
    const threadId = await threadIdOfScope(args)
    const row = await db.orm.public.ComposerDraft.upsert({
      conflictOn: { userId: args.userId, scopeKey: args.scope },
      create: {
        userId: args.userId,
        scopeKey: args.scope,
        threadId,
        text: args.text,
        attachments: JSON.stringify(args.uploads),
        updatedAt: new Date(),
      },
      update: {
        threadId,
        text: args.text,
        attachments: JSON.stringify(args.uploads),
        updatedAt: new Date(),
      },
    })
    return draftOf(row)
  }

  async get(args: { userId: string; scope: string }): Promise<ComposerDraft | null> {
    await threadIdOfScope(args)
    const row = await db.orm.public.ComposerDraft.where({
      userId: args.userId,
      scopeKey: args.scope,
    }).first()
    if (row === null) return null
    return draftOf(row)
  }

  async clear(args: { userId: string; scope: string }): Promise<void> {
    await threadIdOfScope(args)
    const existing = await db.orm.public.ComposerDraft.where({
      userId: args.userId,
      scopeKey: args.scope,
    }).first()
    if (existing === null) return
    await db.orm.public.ComposerDraft.where({
      userId: args.userId,
      scopeKey: args.scope,
    }).delete()
  }
}
