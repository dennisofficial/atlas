import { Injectable } from '@nestjs/common'
import { db } from '../../db'
import type { TranscriptEventDto } from './factory.types'
import { nextTranscriptEventId, nowIso } from './ids'
import { toTranscriptEventDto } from './rows'
import { isUniqueViolation } from './unique-violation'

export type AppendResult = {
  workItemId: string
  event: TranscriptEventDto
  appended: boolean
}

@Injectable()
export class TranscriptService {
  async append(args: {
    surface: string
    externalId: string
    deliveryId: string
    kind: string
    payload: string
    author?: string | undefined
    authorAssociation?: string | undefined
  }): Promise<AppendResult | null> {
    try {
      return await this.appendOnce(args)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      return this.racedReplay(args)
    }
  }

  private async racedReplay(args: {
    surface: string
    externalId: string
    deliveryId: string
  }): Promise<AppendResult> {
    const alias = await db.factorySurfaceAlias.findFirst({
      where: { surface: args.surface, externalId: args.externalId },
    })
    const seen = await db.factoryTranscriptEvent.findFirst({
      where: { surface: args.surface, deliveryId: args.deliveryId },
    })
    if (alias === null || seen === null) {
      throw new Error('unique violation without a stored event — the transcript is inconsistent')
    }
    return { workItemId: alias.workItemId, event: toTranscriptEventDto(seen), appended: false }
  }

  private appendOnce(args: {
    surface: string
    externalId: string
    deliveryId: string
    kind: string
    payload: string
    author?: string | undefined
    authorAssociation?: string | undefined
  }): Promise<AppendResult | null> {
    return db.$transaction(async (tx) => {
      const alias = await tx.factorySurfaceAlias.findFirst({
        where: { surface: args.surface, externalId: args.externalId },
      })
      if (alias === null) return null

      const seen = await tx.factoryTranscriptEvent.findFirst({
        where: { surface: args.surface, deliveryId: args.deliveryId },
      })
      if (seen !== null) {
        return { workItemId: alias.workItemId, event: toTranscriptEventDto(seen), appended: false }
      }

      const at = nowIso()
      const row = await tx.factoryTranscriptEvent.create({
        data: {
          id: nextTranscriptEventId(),
          workItemId: alias.workItemId,
          surface: args.surface,
          deliveryId: args.deliveryId,
          author: args.author ?? null,
          authorAssociation: args.authorAssociation ?? null,
          kind: args.kind,
          payload: args.payload,
          receivedAt: at,
        },
      })
      await tx.factoryWorkItem.update({
        where: { id: alias.workItemId },
        data: { lastActivityAt: at, updatedAt: at },
      })
      return { workItemId: alias.workItemId, event: toTranscriptEventDto(row), appended: true }
    })
  }

  async list(args: { workItemId: string }): Promise<TranscriptEventDto[]> {
    const rows = await db.factoryTranscriptEvent.findMany({
      where: { workItemId: args.workItemId },
      orderBy: { receivedAt: 'asc' },
    })
    return rows.map(toTranscriptEventDto)
  }
}
