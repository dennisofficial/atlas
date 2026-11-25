import { TRPCError } from '@trpc/server'
import { SESSION_ARCHIVED_MESSAGE } from '@dltech/atlas-protocol'

export class SessionArchivedError extends TRPCError {
  constructor() {
    super({ code: 'PRECONDITION_FAILED', message: SESSION_ARCHIVED_MESSAGE })
  }
}
