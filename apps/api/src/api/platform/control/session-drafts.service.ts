import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import {
  attachmentSchema,
  EAttachmentStore,
  MAX_MESSAGE_UPLOADS,
  type Attachment,
  type AttachmentContent,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import type {
  SessionDraft,
  SessionDraftClearInput,
  SessionDraftGetInput,
  SessionDraftPutInput,
} from '@dltech/atlas-protocol'
import { z } from 'zod'

export const NEW_SESSION_DRAFT_SCOPE = 'new'

const attachmentsSchema = z.array(attachmentSchema).max(MAX_MESSAGE_UPLOADS)

type DraftRow = {
  sessionId: string | null
  text: string
  attachments: string
  updatedAt: Date
}

export const scopeKeyOf = (sessionId: string | null): string => sessionId ?? NEW_SESSION_DRAFT_SCOPE

const storedContent = (content: AttachmentContent): AttachmentContent => {
  if (content.store === EAttachmentStore.Upload) {
    return { store: content.store, uploadId: content.uploadId, pathname: content.pathname }
  }
  if (content.store === EAttachmentStore.Media) return { store: content.store, hash: content.hash }
  return content
}

const withoutInline = (attachment: Attachment): Attachment => ({
  ...attachment,
  content: storedContent(attachment.content),
})

const parseAttachments = (raw: string): Attachment[] | null => {
  try {
    const parsed = attachmentsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const draftOf = (row: DraftRow): SessionDraft | null => {
  const attachments = parseAttachments(row.attachments)
  if (attachments === null) return null
  return {
    sessionId: row.sessionId,
    text: row.text,
    attachments,
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class SessionDraftsService {
  constructor(@Inject(ControlPlane) private readonly plane: ControlPlane) {}

  async put(args: { userId: string; input: SessionDraftPutInput }): Promise<SessionDraft> {
    const { userId, input } = args
    await this.requireOwnedSession({ userId, sessionId: input.sessionId })
    const scopeKey = scopeKeyOf(input.sessionId)
    const attachments = input.attachments.map(withoutInline)
    const row = await db.orm.v2.V2ComposerDraft.upsert({
      conflictOn: { userId, scopeKey },
      create: {
        userId,
        scopeKey,
        sessionId: input.sessionId,
        text: input.text,
        attachments: JSON.stringify(attachments),
        updatedAt: new Date(),
      },
      update: {
        sessionId: input.sessionId,
        text: input.text,
        attachments: JSON.stringify(attachments),
        updatedAt: new Date(),
      },
    })
    return {
      sessionId: input.sessionId,
      text: row.text,
      attachments,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async get(args: { userId: string; input: SessionDraftGetInput }): Promise<SessionDraft | null> {
    const { userId, input } = args
    await this.requireOwnedSession({ userId, sessionId: input.sessionId })
    const row = await db.orm.v2.V2ComposerDraft.where({
      userId,
      scopeKey: scopeKeyOf(input.sessionId),
    }).first()
    return row === null ? null : draftOf(row)
  }

  async clear(args: { userId: string; input: SessionDraftClearInput }): Promise<void> {
    const { userId, input } = args
    await this.requireOwnedSession({ userId, sessionId: input.sessionId })
    await db.orm.v2.V2ComposerDraft.where({
      userId,
      scopeKey: scopeKeyOf(input.sessionId),
    }).delete()
  }

  private async requireOwnedSession(args: {
    userId: string
    sessionId: string | null
  }): Promise<void> {
    if (args.sessionId === null) return
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined || session.userId !== args.userId || session.deletedAt !== null) {
      throw new NotFoundException('session not found')
    }
  }
}
