import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '../../db'
import { ownedThread } from './ownership'
import { toTurnDto } from './rows'
import type { RecordTurnDto } from './sessions.dto'
import type { TurnDto, TurnTreeDto } from './sessions.types'

const SUPERVISION_DEPTH_LIMIT = 1

async function readSpawnedThreadIds(args: {
  userId: string
  threadId: string
}): Promise<string[]> {
  const collected: string[] = []
  let frontier: string[] = [args.threadId]

  for (let level = 0; level < SUPERVISION_DEPTH_LIMIT; level += 1) {
    if (frontier.length === 0) return collected
    const rows = await db.thread.findMany({
      where: { spawnerThreadId: { in: frontier }, userId: args.userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    frontier = rows.map((row) => row.id)
    collected.push(...frontier)
  }

  if (frontier.length > 0) {
    const deeper = await db.thread.findMany({
      where: { spawnerThreadId: { in: frontier }, userId: args.userId },
      select: { id: true },
    })
    if (deeper.length > 0) {
      throw new BadRequestException(
        `${args.threadId} supervises agents more than ${SUPERVISION_DEPTH_LIMIT} level deep, and a rollup that walked only ${SUPERVISION_DEPTH_LIMIT} would under-count what the operator spent`,
      )
    }
  }

  return collected
}

@Injectable()
export class TurnsService {
  async record(args: {
    userId: string
    threadId: string
    runId: string
    draft: RecordTurnDto
  }): Promise<void> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    await db.turn.upsert({
      where: { runId: args.runId },
      create: { runId: args.runId, threadId: args.threadId, userId: args.userId, ...args.draft },
      update: { ...args.draft },
    })
  }

  async forThread(args: { userId: string; threadId: string }): Promise<TurnDto[]> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const rows = await db.turn.findMany({
      where: { threadId: args.threadId, userId: args.userId },
      orderBy: { startedAt: 'asc' },
    })
    return rows.map(toTurnDto)
  }

  async forThreadTree(args: { userId: string; threadId: string }): Promise<TurnTreeDto> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const spawned = await readSpawnedThreadIds(args)
    const rows = await db.turn.findMany({
      where: { threadId: { in: [args.threadId, ...spawned] }, userId: args.userId },
      orderBy: [{ startedAt: 'asc' }, { runId: 'asc' }],
    })

    const own: TurnDto[] = []
    const delegated: TurnDto[] = []
    for (const row of rows) {
      if (row.threadId === args.threadId) own.push(toTurnDto(row))
      else delegated.push(toTurnDto(row))
    }
    return { own, delegated }
  }
}
