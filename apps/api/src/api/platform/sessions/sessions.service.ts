import { Injectable } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { wireThreadSchema, type WireSessionNode } from '@dltech/atlas-wire'
import { THREAD_LISTING_LIMIT } from './main-thread-listing'
import { enrichThreads } from './thread-enrichment'
import { withSessions } from './thread-with-session'

@Injectable()
export class SessionsService {
  async list(args: { userId: string; projectId: string | null }): Promise<WireSessionNode[]> {
    const top = await db.orm.public.Session.where({
      userId: args.userId,
      projectId: args.projectId,
      managedBySessionId: null,
    })
      .where((session) => session.mainThreadId.isNotNull())
      .orderBy((session) => session.updatedAt.desc())
      .limit(THREAD_LISTING_LIMIT)
      .all()
    const teammatesOf = await this.teammatesUnder(top)
    const all = [...top, ...[...teammatesOf.values()].flat()]
    const mainIds = all.flatMap((session) => session.mainThreadId ?? [])
    const threads = await db.orm.public.Thread.where((thread) => thread.id.in(mainIds)).all()
    const enriched = await enrichThreads({
      rows: await withSessions({ reader: db, threads }),
      viewerId: args.userId,
    })
    const byThread = new Map(enriched.map((thread) => [thread.id, wireThreadSchema.parse(thread)]))
    const build = (session: Row<'Session'>): WireSessionNode[] => {
      const mainThread = byThread.get(session.mainThreadId ?? '')
      if (mainThread === undefined) return []
      const teammates = (teammatesOf.get(session.id) ?? []).flatMap(build)
      return [{ id: session.id, mainThread, teammates }]
    }
    return top.flatMap(build)
  }

  private async teammatesUnder(
    roots: readonly Row<'Session'>[],
  ): Promise<Map<string, Row<'Session'>[]>> {
    const children = new Map<string, Row<'Session'>[]>()
    const seen = new Set(roots.map((session) => session.id))
    let frontier = roots.map((session) => session.id)
    while (frontier.length > 0) {
      const found = await db.orm.public.Session.where((session) =>
        session.managedBySessionId.in(frontier),
      )
        .orderBy((session) => session.createdAt.asc())
        .all()
      const fresh = found.filter((session) => !seen.has(session.id))
      for (const session of fresh) {
        seen.add(session.id)
        const key = session.managedBySessionId ?? ''
        children.set(key, [...(children.get(key) ?? []), session])
      }
      frontier = fresh.map((session) => session.id)
    }
    return children
  }
}
