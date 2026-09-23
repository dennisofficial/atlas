import type { ThreadId } from '@dltech/atlas-core'

export const SUPERVISION_DEPTH_LIMIT = 2

export class SupervisionTreeTooDeep extends Error {
  constructor({ threadId, limit }: { threadId: ThreadId; limit: number }) {
    super(
      `${threadId} supervises agents more than ${limit} level deep, and a rollup that walked only ${limit} would under-count what the operator spent`,
    )
    this.name = 'SupervisionTreeTooDeep'
  }
}
