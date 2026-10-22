import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ownedThread } from './ownership'
import { toTurnDto } from './rows'
import type { RecordTurnDto } from './sessions.dto'
import type { TurnDto, TurnTreeDto } from './sessions.types'

const SUPERVISION_DEPTH_LIMIT = 2

async function readSpawnedThreadIds(args: { userId: string; threadId: string }): Promise<string[]> {
  const collected: string[] = []
  let frontier: string[] = [args.threadId]

  for (let level = 0; level < SUPERVISION_DEPTH_LIMIT; level += 1) {
    if (frontier.length === 0) return collected
    const rows = await db.orm.public.Thread.where((thread) => thread.spawnerThreadId.in(frontier))
      .where({ userId: args.userId })
      .select('id')
      .orderBy((thread) => thread.createdAt.asc())
      .all()
    frontier = rows.map((row) => row.id)
    collected.push(...frontier)
  }

  if (frontier.length > 0) {
    const deeper = await db.orm.public.Thread.where((thread) => thread.spawnerThreadId.in(frontier))
      .where({ userId: args.userId })
      .select('id')
      .all()
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
    const { startedAt, endedAt, ...rest } = args.draft
    const columns = { ...rest, startedAt: new Date(startedAt), endedAt: new Date(endedAt) }
    await db.orm.public.Turn.upsert({
      create: { runId: args.runId, threadId: args.threadId, userId: args.userId, ...columns },
      update: columns,
    })
  }

  async forThread(args: { userId: string; threadId: string }): Promise<TurnDto[]> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const rows = await db.orm.public.Turn.where({ threadId: args.threadId, userId: args.userId })
      .orderBy((turn) => turn.startedAt.asc())
      .all()
    return rows.map(toTurnDto)
  }

  async forThreadTree(args: { userId: string; threadId: string }): Promise<TurnTreeDto> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const spawned = await readSpawnedThreadIds(args)
    const rows = await db.orm.public.Turn.where((turn) =>
      turn.threadId.in([args.threadId, ...spawned]),
    )
      .where({ userId: args.userId })
      .orderBy([(turn) => turn.startedAt.asc(), (turn) => turn.runId.asc()])
      .all()

    const own: TurnDto[] = []
    const delegated: TurnDto[] = []
    for (const row of rows) {
      if (row.threadId === args.threadId) own.push(toTurnDto(row))
      else delegated.push(toTurnDto(row))
    }
    return { own, delegated }
  }
}
