import type { Db } from '@dltech/atlas-db'

export enum EOperatorRequestStatus {
  Pending = 'pending',
  Answered = 'answered',
  Cancelled = 'cancelled',
  Abandoned = 'abandoned',
  Expired = 'expired',
  Failed = 'failed',
}

export type OperatorRequestInsert = {
  id: string
  sessionId: string
  threadId: string
  kind: string
  prompt: string
  shellId?: string | undefined
  createdAt: Date
}

export type OperatorRequestHeld = 'absent' | 'forbidden' | { sessionId: string }

export class OperatorRequestStore {
  constructor(private readonly db: Db) {}

  async insertPending(row: OperatorRequestInsert): Promise<void> {
    await this.db.orm.v2.V2OperatorRequest.create({
      id: row.id,
      sessionId: row.sessionId,
      threadId: row.threadId,
      kind: row.kind,
      prompt: row.prompt,
      status: EOperatorRequestStatus.Pending,
      createdAt: row.createdAt,
      resolvedAt: null,
      ...(row.shellId === undefined ? {} : { shellId: row.shellId }),
    })
  }

  async sessionOwner(sessionId: string): Promise<string | null> {
    const row = await this.db.orm.v2.V2Session.select('userId').first({ id: sessionId })
    return row?.userId ?? null
  }

  async hasPending(sessionId: string): Promise<boolean> {
    const row = await this.db.orm.v2.V2OperatorRequest.select('id').first({
      sessionId,
      status: EOperatorRequestStatus.Pending,
    })
    return row !== undefined && row !== null
  }

  async held(args: { id: string; userId: string }): Promise<OperatorRequestHeld> {
    const row = await this.db.orm.v2.V2OperatorRequest.select('status', 'sessionId').first({
      id: args.id,
    })
    if (row === null || row === undefined || row.status !== EOperatorRequestStatus.Pending)
      return 'absent'
    const owner = await this.db.orm.v2.V2Session.select('userId').first({ id: row.sessionId })
    if (owner === null || owner === undefined || owner.userId !== args.userId) return 'forbidden'
    return { sessionId: row.sessionId }
  }

  async settle(args: { id: string; status: EOperatorRequestStatus; at: Date }): Promise<boolean> {
    const count = await this.db.orm.v2.V2OperatorRequest.where({
      id: args.id,
      status: EOperatorRequestStatus.Pending,
    }).updateAndCount({ status: args.status, resolvedAt: args.at })
    return count === 1
  }
}
