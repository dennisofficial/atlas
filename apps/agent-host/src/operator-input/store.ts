import type { Db } from '@dltech/atlas-db'

export enum EOperatorRequestStatus {
  Pending = 'pending',
  Answered = 'answered',
  Cancelled = 'cancelled',
  Expired = 'expired',
  Failed = 'failed',
}

export type OperatorRequestInsert = {
  id: string
  sessionId: string
  threadId: string
  kind: string
  prompt: string
  secret: boolean
  shellId?: string | undefined
  createdAt: Date
  expiresAt: Date
}

export class OperatorRequestStore {
  constructor(private readonly db: Db) {}

  async insertPending(row: OperatorRequestInsert): Promise<void> {
    await this.db.orm.v2.V2OperatorRequest.create({
      id: row.id,
      sessionId: row.sessionId,
      threadId: row.threadId,
      kind: row.kind,
      prompt: row.prompt,
      secret: row.secret,
      status: EOperatorRequestStatus.Pending,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: null,
      ...(row.shellId === undefined ? {} : { shellId: row.shellId }),
    })
  }

  async sessionOwner(sessionId: string): Promise<string | null> {
    const row = await this.db.orm.v2.V2Session.select('userId').first({ id: sessionId })
    return row?.userId ?? null
  }

  async statusOf(id: string): Promise<string | null> {
    const row = await this.db.orm.v2.V2OperatorRequest.select('status').first({ id })
    return row?.status ?? null
  }

  async settle(args: { id: string; status: EOperatorRequestStatus; at: Date }): Promise<boolean> {
    const count = await this.db.orm.v2.V2OperatorRequest.where({
      id: args.id,
      status: EOperatorRequestStatus.Pending,
    }).updateAndCount({ status: args.status, resolvedAt: args.at })
    return count === 1
  }
}
