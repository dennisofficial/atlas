import type { Db } from '@dltech/atlas-db'

export class OperatorSessionStore {
  constructor(private readonly db: Db) {}

  async sessionOwner(sessionId: string): Promise<string | null> {
    const row = await this.db.orm.public.Session.select('userId').first({ id: sessionId })
    return row?.userId ?? null
  }
}
